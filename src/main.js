/**
 * Zoopla Property Scraper - Production Ready v3.1.0
 * 
 * BALANCED SPEED + STEALTH:
 * - Only block analytics/tracking (NOT CSS/fonts - affects fingerprint!)
 * - Moderate delays (1.5-2.5s) - fast but safe
 * - Batch data saves
 * - Quick scrolling
 */

import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, Dataset, log } from 'apify';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { firefox } from 'playwright';
import { load as cheerioLoad } from 'cheerio';

// ============================================================================
// CONFIGURATION
// ============================================================================
const BASE_URL = 'https://www.zoopla.co.uk';
const DEFAULT_START_URL = 'https://www.zoopla.co.uk/for-sale/property/london/?q=London&search_source=home&recent_search=true';
const LISTINGS_PER_PAGE = 28;
const MAX_CONCURRENCY = 1;

const PROPERTY_TYPES = ['flat', 'apartment', 'house', 'maisonette', 'bungalow', 'studio', 'duplex', 'penthouse', 'townhouse', 'land', 'detached', 'semi-detached', 'terraced', 'cottage'];

// Only block tracking - NOT CSS/fonts (they affect fingerprint!)
const BLOCKED_URLS = [
    'google-analytics.com',
    'googletagmanager.com',
    'facebook.net',
    'facebook.com',
    'doubleclick.net',
    'hotjar.com',
    'newrelic.com',
    'segment.com',
    'amplitude.com',
    'mixpanel.com',
    'clarity.ms',
    'bing.com/bat',
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const cleanText = (text) => (text ? String(text).replace(/\s+/g, ' ').trim() : null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureAbsoluteUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('http')) return url;
    return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

const extractListingIdFromDivId = (divId) => {
    if (!divId) return null;
    const match = divId.match(/listing_(\d+)/);
    return match ? match[1] : null;
};

const parsePriceValue = (value) => {
    if (typeof value === 'number') return value;
    if (!value) return null;
    const numeric = String(value).replace(/[^\d.]/g, '');
    return numeric ? Number(numeric) : null;
};

const extractUkPostcode = (value) => {
    if (!value) return null;
    const text = String(value);
    const patterns = [
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s+\d[A-Z]{2})\b/i,
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2})\b/i,
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*$/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].toUpperCase();
    }
    return null;
};

const extractPropertyType = (text) => {
    if (!text) return null;
    const lowerText = text.toLowerCase();
    for (const type of PROPERTY_TYPES) {
        if (lowerText.includes(type)) {
            return type.charAt(0).toUpperCase() + type.slice(1);
        }
    }
    return null;
};

// ============================================================================
// HTML EXTRACTION
// ============================================================================
const extractListingsFromHtml = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    const cards = $('div[id^="listing_"]');

    cards.each((_, cardEl) => {
        const card = $(cardEl);
        const divId = card.attr('id');

        const listingId = extractListingIdFromDivId(divId);
        if (!listingId || seen.has(listingId)) return;
        seen.add(listingId);

        const linkEl = card.find('a[href*="/for-sale/details/"]').first();
        const href = linkEl.attr('href');
        const url = ensureAbsoluteUrl(href) || `${BASE_URL}/for-sale/details/${listingId}/`;

        let priceText = cleanText(card.find('p[class*="price_priceText"]').first().text());
        if (!priceText) {
            card.find('p').each((_, el) => {
                const text = $(el).text();
                if (!priceText && text.includes('£')) {
                    const match = text.match(/£[\d,]+/);
                    if (match) priceText = match[0];
                }
            });
        }

        const address = cleanText(
            card.find('address[class*="summary_address"]').first().text() ||
            card.find('address').first().text()
        );

        const description = cleanText(
            card.find('p[class*="summary_summary"]').first().text()
        );

        const amenitiesText = cleanText(
            card.find('p[class*="amenities_amenityList"]').first().text() ||
            card.find('p[class*="amenities"]').first().text()
        );

        let beds = null, baths = null, receptions = null;
        const cardText = card.text();

        const bedsMatch = cardText.match(/(\d+)\s*bed/i);
        const bathsMatch = cardText.match(/(\d+)\s*bath/i);
        const receptionsMatch = cardText.match(/(\d+)\s*reception/i);

        if (bedsMatch) beds = Number(bedsMatch[1]);
        if (bathsMatch) baths = Number(bathsMatch[1]);
        if (receptionsMatch) receptions = Number(receptionsMatch[1]);

        const propertyType = extractPropertyType(description) ||
            extractPropertyType(amenitiesText) ||
            extractPropertyType(cardText);

        let title = null;
        if (beds && propertyType) {
            title = `${beds} bed ${propertyType} for sale`;
        } else if (beds) {
            title = `${beds} bedroom property for sale`;
        } else {
            title = address;
        }

        let image = null;
        const imgEl = card.find('img').first();
        const imgSrc = imgEl.attr('src') || imgEl.attr('data-src');
        if (imgSrc) {
            image = ensureAbsoluteUrl(imgSrc.split('?')[0]);
        }

        let agentName = null;
        const agentImg = card.find('img[alt*="Estate Agent"], img[alt*="logo"]').first();
        if (agentImg.length) {
            agentName = cleanText(agentImg.attr('alt')?.replace(/\s*logo\s*/gi, '').replace(/Estate Agents?/gi, '').trim());
        }

        listings.push({
            listingId,
            url,
            title,
            price: parsePriceValue(priceText),
            priceText,
            address,
            postalCode: extractUkPostcode(address),
            beds,
            baths,
            receptions,
            propertyType,
            description,
            image,
            agentName,
            priceCurrency: 'GBP',
        });
    });

    return listings;
};

// ============================================================================
// PAGINATION
// ============================================================================
const buildSearchUrlForPage = (startUrl, page) => {
    const url = new URL(startUrl);
    if (page > 1) {
        url.searchParams.set('pn', String(page));
    } else {
        url.searchParams.delete('pn');
    }
    return url.toString();
};

// ============================================================================
// MAIN ACTOR
// ============================================================================
await Actor.init();

try {
    const input = (await Actor.getInput()) || {};

    const startUrls = Array.isArray(input.startUrls) && input.startUrls.length ? input.startUrls : null;
    const startUrl = input.startUrl || (startUrls ? null : DEFAULT_START_URL);

    if (!startUrl && !startUrls) {
        log.error('Missing startUrl');
        await Actor.exit({ exitCode: 1 });
    }

    const resultsWanted = Math.max(1, Number.isFinite(+input.results_wanted) ? +input.results_wanted : 50);
    const maxPages = Math.ceil(resultsWanted / LISTINGS_PER_PAGE);

    const proxyConfiguration = await Actor.createProxyConfiguration({
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        countryCode: 'GB',
        ...input.proxyConfiguration,
    });

    log.info('Zoopla Scraper v3.1.0 (Balanced)', { resultsWanted, maxPages });

    const seen = new Set();
    let saved = 0;

    const targets = startUrls || [startUrl];
    const initialRequests = [];

    for (const target of targets) {
        for (let page = 1; page <= maxPages; page++) {
            initialRequests.push({
                url: buildSearchUrlForPage(target, page),
                userData: { page },
            });
        }
    }

    const camoufoxOptions = await camoufoxLaunchOptions({ headless: true, geoip: true });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency: MAX_CONCURRENCY,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 90,
        navigationTimeoutSecs: 60,

        launchContext: {
            launcher: firefox,
            launchOptions: camoufoxOptions,
        },

        browserPoolOptions: {
            useFingerprints: false,
            maxOpenPagesPerBrowser: 1,
            retireBrowserAfterPageCount: 3,
        },

        preNavigationHooks: [
            async ({ page }) => {
                // Moderate delay (balanced: fast but safe)
                await sleep(1500 + Math.random() * 1000);

                // Only block tracking/analytics - NOT images/CSS/fonts
                await page.route('**/*', (route) => {
                    const url = route.request().url();

                    // Block only tracking/analytics
                    if (BLOCKED_URLS.some(blocked => url.includes(blocked))) {
                        return route.abort();
                    }

                    return route.continue();
                });
            },
        ],

        postNavigationHooks: [
            async ({ page }) => {
                await page.waitForLoadState('domcontentloaded');

                // Quick scroll
                await page.evaluate(() => {
                    window.scrollTo(0, 800);
                    window.scrollTo(0, 1600);
                });

                await sleep(800);
            },
        ],

        async requestHandler({ request, page }) {
            const { page: pageNum } = request.userData;

            if (saved >= resultsWanted) {
                log.debug(`Skip page ${pageNum}`);
                return;
            }

            const pageContent = await page.content();

            if (pageContent.includes('Just a moment') || pageContent.includes('Verify you are human')) {
                log.warning(`Cloudflare on page ${pageNum}, waiting...`);
                await sleep(6000);
                await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => { });
            }

            log.info(`Page ${pageNum}/${maxPages}`);

            const html = await page.content();
            const listings = extractListingsFromHtml(html);

            log.info(`Found ${listings.length} listings`);

            if (!listings.length) return;

            const toSave = [];
            for (const listing of listings) {
                if (saved >= resultsWanted) break;

                const key = listing.listingId;
                if (!key || seen.has(key)) continue;
                seen.add(key);

                toSave.push({
                    ...listing,
                    priceValue: parsePriceValue(listing.price) || null,
                    scrapedAt: new Date().toISOString(),
                });
                saved++;
            }

            if (toSave.length) {
                await Dataset.pushData(toSave);
                log.info(`Saved ${saved}/${resultsWanted}`);
            }
        },

        async failedRequestHandler({ request, error }) {
            log.error(`Failed: ${request.url} - ${error.message}`);
        },
    });

    await crawler.run(initialRequests);

    log.info(`Done! ${saved} listings`);
    await Actor.setStatusMessage(`Scraped ${saved} listings`);

} catch (error) {
    log.error(error.message);
    throw error;
} finally {
    await Actor.exit();
}
