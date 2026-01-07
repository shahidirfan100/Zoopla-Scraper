/**
 * Zoopla Property Scraper - Production Ready v2.6.0
 * 
 * CORRECT SELECTORS (from live browser inspection):
 * - Listing container: div[id^="listing_"] (e.g., div#listing_71962539)
 * - Also has class: dkr2t86
 * - Price: p[class*="price_priceText"]
 * - Address: address[class*="summary_address"]
 * - Description: p[class*="summary_summary"]
 * - Amenities (beds/baths): p[class*="amenities_amenityList"] → "1 bed 1 bath 1 reception"
 * - Link: a[href*="/for-sale/details/"]
 * 
 * NOTE: __NEXT_DATA__ does NOT exist on search pages
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

const extractListingId = (url) => {
    if (!url) return null;
    const match =
        url.match(/\/details\/(\d+)/) ||
        url.match(/\/property\/[^/]+\/(\d+)/) ||
        url.match(/\/(\d{6,})\/?$/);
    return match ? match[1] : null;
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
    const match = String(value).match(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i);
    return match ? match[0].toUpperCase() : null;
};

// ============================================================================
// HTML EXTRACTION - CORRECT SELECTORS FROM BROWSER INSPECTION
// ============================================================================
const extractListingsFromHtml = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    // CORRECT SELECTOR: div[id^="listing_"] - each listing has id like "listing_71962539"
    const cards = $('div[id^="listing_"]');

    log.info(`Found ${cards.length} listing cards with div[id^="listing_"]`);

    cards.each((_, cardEl) => {
        const card = $(cardEl);
        const divId = card.attr('id');

        // Extract listing ID from div id
        const listingId = extractListingIdFromDivId(divId);
        if (!listingId) return;

        if (seen.has(listingId)) return;
        seen.add(listingId);

        // Find the detail link
        const linkEl = card.find('a[href*="/for-sale/details/"]').first();
        const href = linkEl.attr('href');
        const url = ensureAbsoluteUrl(href) || `${BASE_URL}/for-sale/details/${listingId}/`;

        // CORRECT: Price - p[class*="price_priceText"]
        let priceText = cleanText(card.find('p[class*="price_priceText"]').first().text());
        if (!priceText) {
            // Fallback: find any text with £
            card.find('p').each((_, el) => {
                const text = $(el).text();
                if (!priceText && text.includes('£')) {
                    const match = text.match(/£[\d,]+/);
                    if (match) priceText = match[0];
                }
            });
        }

        // CORRECT: Address - address[class*="summary_address"]
        const address = cleanText(
            card.find('address[class*="summary_address"]').first().text() ||
            card.find('address').first().text()
        );

        // CORRECT: Description - p[class*="summary_summary"]
        const description = cleanText(
            card.find('p[class*="summary_summary"]').first().text()
        );

        // CORRECT: Amenities - p[class*="amenities_amenityList"] → "1 bed 1 bath 1 reception"
        const amenitiesText = cleanText(
            card.find('p[class*="amenities_amenityList"]').first().text() ||
            card.find('p[class*="amenities"]').first().text()
        );

        // Parse beds, baths, receptions from amenities text
        let beds = null;
        let baths = null;
        let receptions = null;

        if (amenitiesText) {
            const bedsMatch = amenitiesText.match(/(\d+)\s*bed/i);
            const bathsMatch = amenitiesText.match(/(\d+)\s*bath/i);
            const receptionsMatch = amenitiesText.match(/(\d+)\s*reception/i);

            if (bedsMatch) beds = Number(bedsMatch[1]);
            if (bathsMatch) baths = Number(bathsMatch[1]);
            if (receptionsMatch) receptions = Number(receptionsMatch[1]);
        }

        // Fallback: search entire card text for bed/bath patterns
        if (!beds || !baths) {
            const cardText = card.text();
            if (!beds) {
                const match = cardText.match(/(\d+)\s*bed/i);
                if (match) beds = Number(match[1]);
            }
            if (!baths) {
                const match = cardText.match(/(\d+)\s*bath/i);
                if (match) baths = Number(match[1]);
            }
        }

        // Title from heading or link text
        const title = cleanText(
            card.find('h2').first().text() ||
            card.find('h3').first().text() ||
            linkEl.text()
        );

        // Property type from amenities or title
        let propertyType = null;
        if (amenitiesText) {
            // Common types: flat, house, apartment, studio, bungalow
            const typeMatch = amenitiesText.match(/\b(flat|house|apartment|studio|bungalow|maisonette|cottage|penthouse|detached|semi-detached|terraced)\b/i);
            if (typeMatch) propertyType = cleanText(typeMatch[1]);
        }
        if (!propertyType && title) {
            const typeMatch = title.match(/\b(flat|house|apartment|studio|bungalow|maisonette|cottage|penthouse)\b/i);
            if (typeMatch) propertyType = cleanText(typeMatch[1]);
        }

        // Image - first img in the card
        let image = null;
        const imgEl = card.find('img').first();
        const imgSrc = imgEl.attr('src') || imgEl.attr('data-src');
        if (imgSrc) {
            // Clean up image URL (remove :p suffix if present)
            image = ensureAbsoluteUrl(imgSrc.split(':p')[0].split('?')[0]);
        }

        // Agent name
        const agentName = cleanText(
            card.find('[class*="agent"]').first().text() ||
            card.find('[class*="branch"]').first().text()
        );

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
            source: 'html',
        });
    });

    // Fallback if no div[id^="listing_"] found
    if (listings.length === 0) {
        log.warning('No div[id^="listing_"] found, trying fallback with links');

        $('a[href*="/for-sale/details/"]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || href.includes('/contact/')) return;

            const url = ensureAbsoluteUrl(href);
            const listingId = extractListingId(url);

            if (!listingId || seen.has(listingId)) return;
            seen.add(listingId);

            listings.push({
                listingId,
                url,
                title: null,
                price: null,
                priceText: null,
                address: null,
                postalCode: null,
                beds: null,
                baths: null,
                receptions: null,
                propertyType: null,
                description: null,
                image: null,
                agentName: null,
                priceCurrency: 'GBP',
                source: 'html-fallback',
            });
        });
    }

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
    const maxPages = Math.max(1, Number.isFinite(+input.max_pages) ? +input.max_pages : 5);

    const proxyConfiguration = await Actor.createProxyConfiguration({
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        countryCode: 'GB',
        ...input.proxyConfiguration,
    });

    log.info('Zoopla Scraper v2.6.0 Starting', { resultsWanted, maxPages });

    const seen = new Set();
    let saved = 0;

    const targets = startUrls || [startUrl];
    const initialRequests = [];

    for (const target of targets) {
        for (let page = 1; page <= maxPages; page++) {
            initialRequests.push({
                url: buildSearchUrlForPage(target, page),
                userData: { type: 'search', page },
            });
        }
    }

    const camoufoxOptions = await camoufoxLaunchOptions({ headless: true, geoip: true });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency: 1,
        maxRequestRetries: 5,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 90,

        launchContext: {
            launcher: firefox,
            launchOptions: camoufoxOptions,
        },

        browserPoolOptions: {
            useFingerprints: false,
            maxOpenPagesPerBrowser: 1,
            retireBrowserAfterPageCount: 2,
        },

        preNavigationHooks: [
            async () => { await sleep(2000 + Math.random() * 3000); },
        ],

        postNavigationHooks: [
            async ({ page }) => {
                await page.waitForLoadState('domcontentloaded');
                await sleep(2000);

                // Wait for listing cards to appear
                await page.waitForSelector('div[id^="listing_"]', { timeout: 15000 }).catch(() => {
                    log.debug('Listing cards not found with selector');
                });

                // Scroll to load all content
                for (let i = 0; i < 5; i++) {
                    await page.evaluate(() => window.scrollBy(0, 500));
                    await sleep(400);
                }
                await sleep(1000);
            },
        ],

        async requestHandler({ request, page }) {
            const { page: pageNum } = request.userData;

            if (saved >= resultsWanted) return;

            const pageContent = await page.content();

            // Check for Cloudflare
            if (pageContent.includes('Just a moment') || pageContent.includes('Verify you are human')) {
                log.warning(`Cloudflare on page ${pageNum}, waiting...`);
                await sleep(10000);
                await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
            }

            log.info(`Processing page ${pageNum}: ${request.url}`);

            const html = await page.content();
            const listings = extractListingsFromHtml(html);

            log.info(`Page ${pageNum}: Found ${listings.length} listings`);

            if (!listings.length) {
                log.warning(`No listings on page ${pageNum}`);
                const title = await page.title();
                log.debug(`Page title: ${title}`);
                return;
            }

            for (const listing of listings) {
                if (saved >= resultsWanted) break;

                const key = listing.listingId || listing.url;
                if (!key || seen.has(key)) continue;
                seen.add(key);

                await Dataset.pushData({
                    ...listing,
                    priceValue: parsePriceValue(listing.price) || null,
                    scrapedAt: new Date().toISOString(),
                });

                saved++;
                if (saved % 10 === 0) log.info(`Progress: ${saved}/${resultsWanted}`);
            }
        },

        async failedRequestHandler({ request, error }) {
            log.error(`Failed: ${request.url} - ${error.message}`);
        },
    });

    await crawler.run(initialRequests);

    log.info(`Complete! Saved ${saved} listings`);
    await Actor.setStatusMessage(`Scraped ${saved} listings`);

} catch (error) {
    log.error(error.message);
    throw error;
} finally {
    await Actor.exit();
}
