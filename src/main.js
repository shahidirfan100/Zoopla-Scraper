import { Actor, Dataset, log } from 'apify';
import { CheerioCrawler, Configuration } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

// ============================================================================
// CONFIGURATION
// ============================================================================
const BASE_URL = 'https://www.zoopla.co.uk';
const DEFAULT_START_URL = 'https://www.zoopla.co.uk/for-sale/property/london/?q=London&search_source=home&recent_search=true';
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_CONCURRENCY = 3;
const BROWSER_TIMEOUT_MS = 60000;

// Realistic UK-based User Agents (Chrome, Firefox, Safari)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

// Full browser-like headers with sec-ch-* client hints (Apify recommended)
const getStealthHeaders = (userAgent) => {
    const isChrome = userAgent.includes('Chrome') && !userAgent.includes('Firefox');
    const isFirefox = userAgent.includes('Firefox');

    const headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-GB,en;q=0.9,en-US;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': userAgent,
        'Referer': BASE_URL,
    };

    // Add Chrome-specific client hints (helps bypass fingerprinting)
    if (isChrome) {
        headers['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = userAgent.includes('Windows') ? '"Windows"' :
            userAgent.includes('Macintosh') ? '"macOS"' : '"Linux"';
        headers['sec-fetch-dest'] = 'document';
        headers['sec-fetch-mode'] = 'navigate';
        headers['sec-fetch-site'] = 'same-origin';
        headers['sec-fetch-user'] = '?1';
    }

    return headers;
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanText = (text) => (text ? text.replace(/\s+/g, ' ').trim() : null);

const pickFirst = (...values) => {
    for (const value of values) {
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
};

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

const parsePriceValue = (value) => {
    if (typeof value === 'number') return value;
    if (!value) return null;
    const numeric = String(value).replace(/[^\d.]/g, '');
    return numeric ? Number(numeric) : null;
};

const parseNumber = (value) => {
    if (value === null || value === undefined) return null;
    const numeric = String(value).replace(/[^\d.]/g, '');
    if (!numeric) return null;
    return Number(numeric);
};

const extractUkPostcode = (value) => {
    if (!value) return null;
    const match = String(value).match(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i);
    return match ? match[0].toUpperCase() : null;
};

const safeParseJson = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

// ============================================================================
// JSON-LD EXTRACTION (PRIMARY METHOD - Works on Zoopla!)
// ============================================================================
/**
 * Extract property listings from JSON-LD structured data.
 * Zoopla uses SearchResultsPage -> mainEntity (ItemList) -> itemListElement[]
 */
const extractListingsFromJsonLd = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).html();
        if (!raw) return;

        const data = safeParseJson(raw);
        if (!data) return;

        // Handle both direct objects and arrays
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
            // Look for SearchResultsPage with ItemList
            if (item['@type'] === 'SearchResultsPage' && item.mainEntity) {
                const listItems = item.mainEntity.itemListElement || [];
                for (const listItem of listItems) {
                    const property = listItem.item || listItem;
                    const url = ensureAbsoluteUrl(property.url || property['@id']);
                    const listingId = extractListingId(url);
                    const key = listingId || url;

                    if (!key || seen.has(key)) continue;
                    seen.add(key);

                    listings.push({
                        listingId,
                        url,
                        title: cleanText(property.name),
                        description: cleanText(property.description),
                        image: property.image,
                        price: property.offers?.price || null,
                        priceCurrency: property.offers?.priceCurrency || 'GBP',
                        source: 'json-ld',
                    });
                }
            }

            // Also check for RealEstateListing or Product offers (detail pages)
            if (['RealEstateListing', 'Product', 'Residence', 'Apartment', 'House'].includes(item['@type'])) {
                const url = ensureAbsoluteUrl(item.url || item['@id']);
                const listingId = extractListingId(url);
                const key = listingId || url;

                if (!key || seen.has(key)) continue;
                seen.add(key);

                const offered = item.itemOffered || item;
                const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;

                listings.push({
                    listingId,
                    url,
                    title: cleanText(offered.name || item.name),
                    description: cleanText(offered.description || item.description),
                    image: offered.image || item.image,
                    price: offer?.price || null,
                    priceCurrency: offer?.priceCurrency || 'GBP',
                    source: 'json-ld',
                });
            }

            // Handle @graph structures
            if (item['@graph'] && Array.isArray(item['@graph'])) {
                for (const graphItem of item['@graph']) {
                    if (graphItem['@type'] === 'ItemList') {
                        const listItems = graphItem.itemListElement || [];
                        for (const listItem of listItems) {
                            const property = listItem.item || listItem;
                            const url = ensureAbsoluteUrl(property.url || property['@id']);
                            const listingId = extractListingId(url);
                            const key = listingId || url;

                            if (!key || seen.has(key)) continue;
                            seen.add(key);

                            listings.push({
                                listingId,
                                url,
                                title: cleanText(property.name),
                                description: cleanText(property.description),
                                image: property.image,
                                price: property.offers?.price || null,
                                priceCurrency: property.offers?.priceCurrency || 'GBP',
                                source: 'json-ld',
                            });
                        }
                    }
                }
            }
        }
    });

    return listings;
};

// ============================================================================
// HTML ENRICHMENT (SECONDARY - For additional fields)
// ============================================================================
/**
 * Extract additional listing data from HTML cards that isn't in JSON-LD.
 * Extracts: beds, baths, address, propertyType, agentName
 */
const enrichListingsFromHtml = (html, listings) => {
    const $ = cheerioLoad(html);
    const enriched = [];

    // Build a map of listing cards by URL for quick lookup
    const cardDataMap = new Map();

    // Find all listing cards
    $('a[href^="/for-sale/details/"]').each((_, el) => {
        const href = $(el).attr('href');
        const url = ensureAbsoluteUrl(href);
        const listingId = extractListingId(url);
        const key = listingId || url;

        if (!key) return;

        // Navigate up to find the card container
        const card = $(el).closest('[data-testid]').length
            ? $(el).closest('[data-testid]')
            : $(el).parent().parent().parent();

        // Extract data from the card
        const beds = parseNumber(card.find('[data-testid="beds"], .num-beds, .beds').first().text());
        const baths = parseNumber(card.find('[data-testid="baths"], .num-baths, .baths').first().text());
        const address = cleanText(card.find('[data-testid="address"], .address, [data-testid="listing-address"]').first().text());
        const priceText = cleanText(card.find('[data-testid="price"], .price, [data-testid="listing-price"]').first().text());
        const propertyType = cleanText(card.find('[data-testid="property-type"], .property-type').first().text());
        const agentName = cleanText(card.find('[data-testid="agent-name"], .agent__name, .agent-name').first().text());

        cardDataMap.set(key, {
            beds,
            baths,
            address,
            priceText,
            propertyType,
            agentName,
        });
    });

    // Enrich listings with HTML data
    for (const listing of listings) {
        const key = listing.listingId || listing.url;
        const htmlData = cardDataMap.get(key) || {};

        enriched.push({
            ...listing,
            beds: htmlData.beds || null,
            baths: htmlData.baths || null,
            address: htmlData.address || null,
            propertyType: htmlData.propertyType || null,
            agentName: htmlData.agentName || null,
            // Keep JSON-LD price if available, otherwise use HTML price
            price: listing.price || parsePriceValue(htmlData.priceText) || null,
            priceText: htmlData.priceText || null,
        });
    }

    return enriched;
};

/**
 * Fallback: Extract listings directly from HTML if JSON-LD fails.
 */
const extractListingsFromHtmlDirect = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    $('a[href^="/for-sale/details/"]').each((_, el) => {
        const href = $(el).attr('href');
        const url = ensureAbsoluteUrl(href);
        const listingId = extractListingId(url);
        const key = listingId || url;

        if (!key || seen.has(key)) return;
        seen.add(key);

        const card = $(el).closest('[data-testid]').length
            ? $(el).closest('[data-testid]')
            : $(el).parent().parent().parent();

        const title = cleanText(card.find('h2, [data-testid="listing-title"]').first().text());
        const priceText = cleanText(card.find('[data-testid="price"], .price').first().text());
        const address = cleanText(card.find('[data-testid="address"], .address').first().text());
        const beds = parseNumber(card.find('[data-testid="beds"], .num-beds').first().text());
        const baths = parseNumber(card.find('[data-testid="baths"], .num-baths').first().text());
        const image = card.find('img').first().attr('src');

        listings.push({
            listingId,
            url,
            title,
            price: parsePriceValue(priceText),
            priceText,
            address,
            beds,
            baths,
            image: ensureAbsoluteUrl(image),
            source: 'html',
        });
    });

    return listings;
};

// ============================================================================
// DETAIL PAGE PARSING
// ============================================================================
const DETAIL_SELECTORS = {
    title: ['h1', '[data-testid="listing-title"]', '[data-testid="property-title"]'],
    price: ['[data-testid="price"]', '[data-testid="listing-price"]', '.price', '.listing-price'],
    address: ['[data-testid="address"]', '.address', '.property-address', 'h1'],
    propertyType: ['[data-testid="property-type"]', '.property-type'],
    beds: ['[data-testid="beds"]', '[data-testid="property-bedrooms"]', '.beds', '.num-bedrooms'],
    baths: ['[data-testid="baths"]', '[data-testid="property-bathrooms"]', '.baths', '.num-bathrooms'],
    floorArea: ['[data-testid="floor-area"]', '.floor-area', '.listing-floor-area'],
    tenure: ['[data-testid="tenure"]', '.tenure'],
    description: ['[data-testid="description"]', '[data-testid="listing-description"]', '.listing-description', '.property-description'],
    features: ['[data-testid="key-features"] li', '.key-features li', '.property-features li'],
    agentName: ['[data-testid="agent-name"]', '.agent__name', '.listing-agent__name', '.agent-name'],
};

const getFirstText = ($, selectors) => {
    for (const selector of selectors) {
        const text = cleanText($(selector).first().text());
        if (text) return text;
    }
    return null;
};

const getAllText = ($, selectors) => {
    const results = new Set();
    for (const selector of selectors) {
        $(selector).each((_, el) => {
            const text = cleanText($(el).text());
            if (text) results.add(text);
        });
    }
    return results.size ? Array.from(results) : null;
};

const normalizeImages = (images) => {
    if (!images) return null;
    const list = Array.isArray(images) ? images : [images];
    const urls = list
        .map((img) => (typeof img === 'string' ? img : img?.url || img?.contentUrl))
        .filter(Boolean)
        .map(ensureAbsoluteUrl);
    return urls.length ? Array.from(new Set(urls)) : null;
};

const parseDetailFromJsonLd = (html) => {
    const $ = cheerioLoad(html);

    let detailData = null;

    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).html();
        if (!raw) return;

        const data = safeParseJson(raw);
        if (!data) return;

        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);

        for (const item of items) {
            if (['RealEstateListing', 'Product', 'Residence', 'Apartment', 'House', 'SingleFamilyResidence'].includes(item['@type'])) {
                const offered = item.itemOffered || item;
                const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                const address = offered.address || item.address || {};
                const geo = offered.geo || item.geo || {};

                detailData = {
                    title: cleanText(offered.name || item.name),
                    description: cleanText(offered.description || item.description),
                    price: offer?.price || null,
                    priceCurrency: offer?.priceCurrency || 'GBP',
                    address: typeof address === 'string' ? address : cleanText(address.streetAddress),
                    postalCode: cleanText(address.postalCode),
                    locality: cleanText(address.addressLocality),
                    region: cleanText(address.addressRegion),
                    country: cleanText(address.addressCountry?.name || address.addressCountry),
                    propertyType: cleanText(offered['@type'] || item.category),
                    beds: parseNumber(offered.numberOfRooms || offered.numberOfBedrooms),
                    baths: parseNumber(offered.numberOfBathroomsTotal || offered.numberOfBathrooms),
                    floorArea: offered.floorSize?.value || null,
                    images: normalizeImages(offered.image || item.image),
                    latitude: geo.latitude || null,
                    longitude: geo.longitude || null,
                };
                return false; // Stop iteration once found
            }
        }
    });

    return detailData;
};

const parseDetailHtml = (html) => {
    const $ = cheerioLoad(html);

    // Try JSON-LD first (most reliable)
    const jsonLdData = parseDetailFromJsonLd(html) || {};

    // Fallback to HTML selectors
    const title = pickFirst(jsonLdData.title, getFirstText($, DETAIL_SELECTORS.title));
    const priceText = pickFirst(jsonLdData.price, getFirstText($, DETAIL_SELECTORS.price));
    const addressText = pickFirst(jsonLdData.address, getFirstText($, DETAIL_SELECTORS.address));
    const features = getAllText($, DETAIL_SELECTORS.features);
    const images = pickFirst(
        jsonLdData.images,
        normalizeImages($('meta[property="og:image"]').attr('content'))
    );
    const agentName = getFirstText($, DETAIL_SELECTORS.agentName);

    return {
        title,
        price: priceText,
        priceValue: parsePriceValue(priceText) || jsonLdData.price,
        priceCurrency: jsonLdData.priceCurrency || 'GBP',
        address: addressText,
        postalCode: pickFirst(jsonLdData.postalCode, extractUkPostcode(addressText)),
        locality: jsonLdData.locality || null,
        region: jsonLdData.region || null,
        country: jsonLdData.country || null,
        propertyType: pickFirst(jsonLdData.propertyType, getFirstText($, DETAIL_SELECTORS.propertyType)),
        beds: pickFirst(jsonLdData.beds, parseNumber(getFirstText($, DETAIL_SELECTORS.beds))),
        baths: pickFirst(jsonLdData.baths, parseNumber(getFirstText($, DETAIL_SELECTORS.baths))),
        floorArea: pickFirst(jsonLdData.floorArea, getFirstText($, DETAIL_SELECTORS.floorArea)),
        tenure: getFirstText($, DETAIL_SELECTORS.tenure),
        description: pickFirst(jsonLdData.description, getFirstText($, DETAIL_SELECTORS.description)),
        features: features?.length ? Array.from(new Set(features)) : null,
        images,
        agentName,
        latitude: jsonLdData.latitude || null,
        longitude: jsonLdData.longitude || null,
    };
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
// DETECTION HELPERS
// ============================================================================
const detectBlockReason = (response) => {
    if (!response) return null;
    const statusCode = response.statusCode || response.status;
    if ([403, 429, 503].includes(statusCode)) return `HTTP_${statusCode}`;

    const body = typeof response.body === 'string' ? response.body : '';
    if (!body) return null;

    if (/just a moment|verify you are human|captcha|enable javascript|cloudflare/i.test(body)) {
        return 'cloudflare_challenge';
    }
    return null;
};

// ============================================================================
// MAIN ACTOR
// ============================================================================
await Actor.init();

try {
    const input = (await Actor.getInput()) || {};

    // Input validation
    const startUrls = Array.isArray(input.startUrls) && input.startUrls.length ? input.startUrls : null;
    const startUrl = input.startUrl || (startUrls ? null : DEFAULT_START_URL);

    if (!startUrl && !startUrls) {
        const message = 'Missing required field: startUrl or startUrls.';
        log.error(message);
        await Actor.setStatusMessage(message);
        await Actor.setValue('INPUT_VALIDATION_ERROR', { message, timestamp: new Date().toISOString() });
        await Actor.exit({ exitCode: 1 });
    }

    const resultsWanted = Math.max(1, Number.isFinite(+input.results_wanted) ? +input.results_wanted : 50);
    const maxPages = Math.max(1, Number.isFinite(+input.max_pages) ? +input.max_pages : 10);
    const collectDetails = input.collectDetails !== false;
    const maxConcurrency = Math.min(DEFAULT_MAX_CONCURRENCY, input.maxConcurrency || DEFAULT_MAX_CONCURRENCY);

    // Proxy configuration with Apify recommendations
    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...input.proxyConfiguration })
        : await Actor.createProxyConfiguration({
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
            countryCode: 'GB', // UK proxies for Zoopla
        });

    log.info('Zoopla Scraper Starting', {
        targets: startUrls?.length || 1,
        resultsWanted,
        maxPages,
        collectDetails,
        maxConcurrency,
        proxyCountry: 'GB',
    });

    // State management
    const seen = new Set();
    const blockEvents = [];
    const stats = {
        pagesProcessed: 0,
        listingsSaved: 0,
        methodsUsed: new Set(),
        blockedRequests: 0,
    };
    let saved = 0;

    // Build initial request queue
    const targets = startUrls || [startUrl];
    const initialRequests = [];

    for (const target of targets) {
        for (let page = 1; page <= maxPages; page++) {
            initialRequests.push({
                url: buildSearchUrlForPage(target, page),
                userData: {
                    type: 'search',
                    page,
                    startUrl: target,
                },
            });
        }
    }

    // Create CheerioCrawler with Apify stealth recommendations
    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,

        // Stealth: Add realistic delays between requests
        minConcurrency: 1,
        maxRequestsPerMinute: 30, // Avoid rate limiting

        // Pre-navigation hook: Set stealth headers
        preNavigationHooks: [
            async ({ request }) => {
                const userAgent = getRandomUserAgent();
                request.headers = {
                    ...getStealthHeaders(userAgent),
                    ...request.headers,
                };

                // Add random delay to mimic human behavior
                await sleep(500 + Math.random() * 1500);
            },
        ],

        // Main request handler
        async requestHandler({ request, $, body, response }) {
            const { type, page, startUrl: targetUrl } = request.userData;

            // Check for blocks
            const blockReason = detectBlockReason(response);
            if (blockReason) {
                stats.blockedRequests++;
                blockEvents.push({
                    url: request.url,
                    statusCode: response?.statusCode,
                    reason: blockReason,
                    timestamp: new Date().toISOString(),
                });
                log.warning(`Blocked (${blockReason}): ${request.url}`);
                return; // Skip blocked pages
            }

            if (saved >= resultsWanted) {
                log.debug('Results limit reached, skipping request');
                return;
            }

            if (type === 'search') {
                log.debug(`Processing search page ${page}: ${request.url}`);

                // Primary: Extract from JSON-LD
                let listings = extractListingsFromJsonLd(body);

                if (listings.length > 0) {
                    stats.methodsUsed.add('json-ld');
                    log.debug(`Found ${listings.length} listings via JSON-LD on page ${page}`);

                    // Enrich with HTML data (beds, baths, etc.)
                    listings = enrichListingsFromHtml(body, listings);
                } else {
                    // Fallback: Direct HTML extraction
                    listings = extractListingsFromHtmlDirect(body);
                    if (listings.length > 0) {
                        stats.methodsUsed.add('html');
                        log.debug(`Found ${listings.length} listings via HTML on page ${page}`);
                    }
                }

                if (!listings.length) {
                    log.debug(`No listings found on page ${page}`);
                    return;
                }

                stats.pagesProcessed++;

                // Process each listing
                for (const listing of listings) {
                    if (saved >= resultsWanted) break;

                    const key = listing.listingId || listing.url;
                    if (!key || seen.has(key)) continue;
                    seen.add(key);

                    // Build property object
                    const property = {
                        listingId: listing.listingId || null,
                        url: listing.url,
                        title: listing.title || null,
                        price: listing.price || null,
                        priceValue: parsePriceValue(listing.price) || null,
                        priceCurrency: listing.priceCurrency || 'GBP',
                        priceText: listing.priceText || null,
                        address: listing.address || null,
                        postalCode: extractUkPostcode(listing.address),
                        beds: listing.beds || null,
                        baths: listing.baths || null,
                        propertyType: listing.propertyType || null,
                        description: listing.description || null,
                        image: listing.image || null,
                        agentName: listing.agentName || null,
                        source: listing.source,
                        scrapedAt: new Date().toISOString(),
                    };

                    await Dataset.pushData(property);
                    saved++;
                    stats.listingsSaved = saved;

                    // Log progress every 10 items
                    if (saved % 10 === 0) {
                        log.info(`Progress: ${saved}/${resultsWanted} listings saved`);
                    }
                }

            } else if (type === 'detail') {
                // Detail page processing (if collectDetails is enabled)
                log.debug(`Processing detail page: ${request.url}`);

                const detail = parseDetailHtml(body);
                const listingId = extractListingId(request.url);

                const property = {
                    listingId,
                    url: request.url,
                    ...detail,
                    source: 'detail',
                    scrapedAt: new Date().toISOString(),
                };

                await Dataset.pushData(property);
                saved++;
                stats.listingsSaved = saved;
            }
        },

        // Error handling
        async failedRequestHandler({ request, error }) {
            log.error(`Request failed: ${request.url}`, { error: error.message });
            stats.blockedRequests++;
        },
    });

    // Run the crawler
    await crawler.run(initialRequests);

    // Save diagnostics
    if (blockEvents.length) {
        await Actor.setValue('BLOCKED_REQUESTS', blockEvents);
    }

    if (saved === 0) {
        const message = stats.blockedRequests > 0
            ? `No listings scraped. ${stats.blockedRequests} requests were blocked. Try using residential proxies.`
            : 'No listings were scraped. Review the logs for details.';
        log.warning(message);
        await Actor.setStatusMessage(message);
    } else {
        const summary = {
            listingsSaved: saved,
            pagesProcessed: stats.pagesProcessed,
            methodsUsed: Array.from(stats.methodsUsed),
            blockedRequests: stats.blockedRequests,
        };
        log.info(`Scraping complete!`, summary);
        await Actor.setStatusMessage(`Successfully scraped ${saved} listings`);
        await Actor.setValue('RUN_SUMMARY', summary);
    }

} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    await Actor.setStatusMessage(`Failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}
