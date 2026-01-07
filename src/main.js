import { Actor, Dataset, log } from 'apify';
import { gotScraping } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

const BASE_URL = 'https://www.zoopla.co.uk';
const DEFAULT_START_URL = 'https://www.zoopla.co.uk/for-sale/property/london/?q=London&search_source=home&recent_search=true';
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_CONCURRENCY = 3;
const ENABLE_JSON_API = true;
const ENABLE_HTML_FALLBACK = true;
const ENABLE_SITEMAP_FALLBACK = true;
const BLOCK_EVENTS = [];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

const DEFAULT_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: BASE_URL,
    'Upgrade-Insecure-Requests': '1',
};

const JSON_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'X-Requested-With': 'XMLHttpRequest',
};

const detectBlockReason = (response) => {
    if (!response) return null;
    const statusCode = response.statusCode;
    if ([403, 429, 503].includes(statusCode)) return `HTTP_${statusCode}`;
    const body = typeof response.body === 'string' ? response.body : '';
    if (!body) return null;
    if (/just a moment|verify you are human|captcha|enable javascript/i.test(body)) return 'challenge';
    return null;
};

const recordBlockEvent = ({ url, statusCode, reason }) => {
    if (BLOCK_EVENTS.length >= 50) return;
    BLOCK_EVENTS.push({
        url,
        statusCode: statusCode ?? null,
        reason,
        timestamp: new Date().toISOString(),
    });
};

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
    agentUrl: ['[data-testid="agent-name"] a', '.agent__name a', '.listing-agent__name a', '.agent-name a'],
};

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanText = (text) => (text ? text.replace(/\s+/g, ' ').trim() : null);

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

const isListingUrl = (url) =>
    /\/for-sale\/details\/\d+/i.test(url) || /\/for-sale\/property\/[^/]+\/\d+/i.test(url);

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

const createLimiter = (maxConcurrency) => {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= maxConcurrency || queue.length === 0) return;
        active += 1;
        const { task, resolve, reject } = queue.shift();
        task()
            .then(resolve)
            .catch(reject)
            .finally(() => {
                active -= 1;
                next();
            });
    };
    return (task) =>
        new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });
            next();
        });
};

const safeParseJson = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const requestPage = async ({
    url,
    proxyConfiguration,
    responseType = 'text',
    headers = {},
    timeoutMs = 30000,
    referer,
}) => {
    const response = await gotScraping({
        url,
        responseType,
        headers: {
            ...DEFAULT_HEADERS,
            'User-Agent': getRandomUserAgent(),
            ...(referer ? { Referer: referer } : {}),
            ...headers,
        },
        proxyUrl: proxyConfiguration ? await proxyConfiguration.newUrl() : undefined,
        timeout: { request: timeoutMs },
        throwHttpErrors: false,
        retry: {
            limit: 2,
            methods: ['GET'],
            statusCodes: [429, 500, 502, 503, 504],
            errorCodes: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'],
        },
    });

    if (response.statusCode === 429) {
        await sleep(2000 + Math.random() * 2000);
    }

    const blockReason = detectBlockReason(response);
    if (blockReason) {
        recordBlockEvent({ url, statusCode: response.statusCode, reason: blockReason });
        log.warning(`Possible block (${blockReason}) for ${url}`);
    }

    return response;
};

const getSearchContext = (startUrl) => {
    try {
        const url = new URL(startUrl);
        const query = url.searchParams.get('q') || url.searchParams.get('area');
        const pathParts = url.pathname.split('/').filter(Boolean);
        const locationSlug = pathParts.length >= 3 ? pathParts[2] : pathParts[pathParts.length - 1];
        return { query, locationSlug };
    } catch {
        return { query: null, locationSlug: null };
    }
};

const buildSearchUrlForPage = (startUrl, page) => {
    const url = new URL(startUrl);
    if (page > 1) {
        url.searchParams.set('pn', String(page));
    } else {
        url.searchParams.delete('pn');
    }
    return url.toString();
};

const buildApiCandidates = ({ startUrl, page, pageSize }) => {
    const { query, locationSlug } = getSearchContext(startUrl);
    const searchTerm = query || (locationSlug ? locationSlug.replace(/-/g, ' ') : null);

    const baseParams = new URLSearchParams();
    if (searchTerm) baseParams.set('q', searchTerm);
    baseParams.set('listing_status', 'sale');
    baseParams.set('page_number', String(page));
    baseParams.set('page_size', String(pageSize));

    return [
        {
            name: 'search-results-v1',
            url: `${BASE_URL}/api/v1/search_results/?${baseParams.toString()}`,
        },
        {
            name: 'property-search-v1',
            url: `${BASE_URL}/api/v1/property_search/?${baseParams.toString()}`,
        },
        {
            name: 'search-results-v2',
            url: `${BASE_URL}/api/v2/search_results/?${baseParams.toString()}`,
        },
        {
            name: 'search-by-url',
            url: `${BASE_URL}/api/search_results/?search_url=${encodeURIComponent(startUrl)}&page_number=${page}&page_size=${pageSize}`,
        },
    ];
};

const extractJsonLd = (html) => {
    const $ = cheerioLoad(html);
    const jsonLdData = [];

    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim();
        if (!raw) return;
        const parsed = safeParseJson(raw);
        if (!parsed) return;
        if (Array.isArray(parsed)) {
            jsonLdData.push(...parsed);
        } else {
            jsonLdData.push(parsed);
        }
    });

    return jsonLdData;
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

const parseAddress = (address) => {
    if (!address) return {};
    if (typeof address === 'string') {
        return {
            address: cleanText(address),
            postalCode: extractUkPostcode(address),
        };
    }

    return {
        streetAddress: cleanText(address.streetAddress),
        locality: cleanText(address.addressLocality),
        region: cleanText(address.addressRegion),
        postalCode: cleanText(address.postalCode),
        country: cleanText(address.addressCountry?.name || address.addressCountry),
    };
};

const parsePropertyFromJsonLd = (jsonLdArray) => {
    if (!Array.isArray(jsonLdArray) || jsonLdArray.length === 0) return null;

    const flattened = jsonLdArray.flatMap((item) => (item && item['@graph'] ? item['@graph'] : item));
    const listing = flattened.find((item) =>
        ['RealEstateListing', 'Product', 'Residence', 'Apartment', 'House', 'SingleFamilyResidence'].includes(item?.['@type'])
    );

    if (!listing) return null;

    const offered = listing.itemOffered || listing;
    const offer = Array.isArray(listing.offers) ? listing.offers[0] : listing.offers || offered.offers;
    const address = parseAddress(offered.address || listing.address);
    const geo = offered.geo || listing.geo;
    const images = normalizeImages(offered.image || listing.image);
    const seller = offered.seller || offered.provider || listing.seller || listing.provider;
    const agentName = cleanText(seller?.name);
    const agentUrl = seller?.url || seller?.sameAs || null;

    const features = Array.isArray(offered.additionalProperty)
        ? offered.additionalProperty
              .map((prop) => prop?.name || prop?.value)
              .filter(Boolean)
        : null;

    return {
        title: cleanText(offered.name || listing.name),
        price: offer?.price || offer?.priceSpecification?.price || null,
        priceCurrency: offer?.priceCurrency || offer?.priceSpecification?.priceCurrency || null,
        address: address.address || null,
        streetAddress: address.streetAddress || null,
        locality: address.locality || null,
        region: address.region || null,
        postalCode: address.postalCode || null,
        country: address.country || null,
        description: cleanText(offered.description || listing.description),
        propertyType: cleanText(offered['@type'] || offered.category || listing.category),
        beds: parseNumber(offered.numberOfRooms || offered.numberOfBedrooms || listing.numberOfRooms),
        baths: parseNumber(offered.numberOfBathroomsTotal || offered.numberOfBathrooms || listing.numberOfBathroomsTotal),
        floorArea: offered.floorSize?.value || offered.floorSize?.valueReference || offered.floorSize?.size || null,
        images,
        latitude: geo?.latitude || null,
        longitude: geo?.longitude || null,
        features: features?.length ? Array.from(new Set(features)) : null,
        agentName,
        agentUrl,
    };
};

const extractListingsFromJsonLd = (jsonLdArray) => {
    if (!Array.isArray(jsonLdArray)) return [];
    const listings = [];
    const candidates = [];

    for (const item of jsonLdArray) {
        if (!item) continue;
        if (Array.isArray(item['@graph'])) {
            candidates.push(...item['@graph']);
        } else {
            candidates.push(item);
        }
    }

    for (const item of candidates) {
        if (!item) continue;
        if (item['@type'] !== 'ItemList') continue;
        const listItems = item.itemListElement || [];

        if (Array.isArray(listItems)) {
            for (const listItem of listItems) {
                const target = listItem?.item || listItem;
                const url = target?.url || target?.['@id'];
                if (!url) continue;
                listings.push({
                    url: ensureAbsoluteUrl(url),
                    listingId: extractListingId(url),
                    title: cleanText(target?.name),
                });
            }
        }
    }

    return listings;
};

const isListingLike = (value) => {
    if (!value || typeof value !== 'object') return false;
    return Boolean(
        value.listing_id ||
            value.listingId ||
            value.id ||
            value.details_url ||
            value.detailsUrl ||
            value.url ||
            value.listing_url ||
            value.listingUrl
    );
};

const normalizeListing = (item) => {
    if (!item || typeof item !== 'object') return null;

    const url =
        item.details_url ||
        item.detailsUrl ||
        item.listing_url ||
        item.listingUrl ||
        item.url ||
        item.uri ||
        null;

    const listingId = item.listing_id || item.listingId || item.id || extractListingId(url);

    const priceValue =
        parsePriceValue(item.price) ||
        parsePriceValue(item.price_amount) ||
        parsePriceValue(item.price_value) ||
        parsePriceValue(item.price_min) ||
        parsePriceValue(item.price_max);

    const priceText = item.price_formatted || item.price_display || item.price || null;

    return {
        listingId: listingId ? String(listingId) : null,
        url: ensureAbsoluteUrl(url),
        title: cleanText(item.title || item.heading || item.summary || item.short_description),
        address: cleanText(item.displayable_address || item.address || item.street_name),
        locality: cleanText(item.town || item.city || item.location || item.post_town),
        postalCode: cleanText(item.postcode || item.post_code),
        price: priceText,
        priceValue,
        beds: parseNumber(item.num_bedrooms || item.bedrooms || item.beds),
        baths: parseNumber(item.num_bathrooms || item.bathrooms || item.baths),
        propertyType: cleanText(item.property_type || item.propertyType || item.listing_type),
        latitude: item.latitude || item.lat || null,
        longitude: item.longitude || item.lng || item.lon || null,
    };
};

const extractListingsFromApiResponse = (payload) => {
    const listings = [];
    const seenItems = new Set();
    const stack = [payload];
    const visited = new Set();
    let safety = 0;

    while (stack.length && safety < 5000) {
        safety += 1;
        const current = stack.pop();
        if (!current) continue;

        if (Array.isArray(current)) {
            if (current.some(isListingLike)) {
                for (const item of current) {
                    if (isListingLike(item)) listings.push(item);
                }
            }
            for (const item of current) stack.push(item);
            continue;
        }

        if (typeof current === 'object') {
            if (visited.has(current)) continue;
            visited.add(current);
            for (const value of Object.values(current)) stack.push(value);
        }
    }

    const normalized = [];
    for (const item of listings) {
        const entry = normalizeListing(item);
        if (!entry) continue;
        const key = entry.listingId || entry.url;
        if (!key || seenItems.has(key)) continue;
        seenItems.add(key);
        normalized.push(entry);
    }

    return normalized;
};

const extractListingsFromEmbeddedJson = (html) => {
    const $ = cheerioLoad(html);
    const results = [];

    const nextDataRaw = $('#__NEXT_DATA__').text().trim();
    if (nextDataRaw) {
        const data = safeParseJson(nextDataRaw);
        if (data) results.push(...extractListingsFromApiResponse(data));
    }

    return results;
};

const extractListingsFromHtml = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    const jsonLdListings = extractListingsFromJsonLd(extractJsonLd(html));
    for (const listing of jsonLdListings) {
        const key = listing.listingId || listing.url;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        listings.push(listing);
    }

    const embeddedListings = extractListingsFromEmbeddedJson(html);
    for (const listing of embeddedListings) {
        const key = listing.listingId || listing.url;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        listings.push(listing);
    }

    $('a[href*="/for-sale/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        if (!isListingUrl(href)) return;
        const url = ensureAbsoluteUrl(href);
        const listingId = extractListingId(url);
        const key = listingId || url;
        if (!key || seen.has(key)) return;
        seen.add(key);
        listings.push({ url, listingId });
    });

    return listings;
};

const parseDetailHtml = (html) => {
    const $ = cheerioLoad(html);
    const jsonLdData = parsePropertyFromJsonLd(extractJsonLd(html)) || {};

    const title = jsonLdData.title || getFirstText($, DETAIL_SELECTORS.title);
    const priceText = jsonLdData.price || getFirstText($, DETAIL_SELECTORS.price);
    const addressText = jsonLdData.address || getFirstText($, DETAIL_SELECTORS.address);

    const features = jsonLdData.features || getAllText($, DETAIL_SELECTORS.features);

    const images = jsonLdData.images || normalizeImages($('meta[property="og:image"]').attr('content'));

    const agentName = jsonLdData.agentName || getFirstText($, DETAIL_SELECTORS.agentName);
    const agentUrl = jsonLdData.agentUrl || ensureAbsoluteUrl($(`${DETAIL_SELECTORS.agentUrl.join(', ')}`).first().attr('href'));

    return {
        title,
        price: priceText,
        priceCurrency: jsonLdData.priceCurrency || null,
        address: addressText,
        streetAddress: jsonLdData.streetAddress || null,
        locality: jsonLdData.locality || null,
        region: jsonLdData.region || null,
        postalCode: jsonLdData.postalCode || extractUkPostcode(addressText),
        country: jsonLdData.country || null,
        propertyType: jsonLdData.propertyType || getFirstText($, DETAIL_SELECTORS.propertyType),
        beds: jsonLdData.beds || parseNumber(getFirstText($, DETAIL_SELECTORS.beds)),
        baths: jsonLdData.baths || parseNumber(getFirstText($, DETAIL_SELECTORS.baths)),
        floorArea: jsonLdData.floorArea || getFirstText($, DETAIL_SELECTORS.floorArea),
        tenure: jsonLdData.tenure || getFirstText($, DETAIL_SELECTORS.tenure),
        description: jsonLdData.description || getFirstText($, DETAIL_SELECTORS.description),
        features,
        images,
        agentName,
        agentUrl,
        latitude: jsonLdData.latitude || null,
        longitude: jsonLdData.longitude || null,
    };
};

const buildProperty = ({ listing, detail, source }) => {
    const url = ensureAbsoluteUrl(listing?.url || detail?.url);
    const listingId = listing?.listingId || detail?.listingId || extractListingId(url) || url;

    const priceValue =
        parsePriceValue(detail?.price) ||
        parsePriceValue(listing?.priceValue) ||
        parsePriceValue(listing?.price) ||
        null;

    const address = detail?.address || listing?.address || null;

    return {
        listingId: listingId || null,
        url,
        title: detail?.title || listing?.title || null,
        price: detail?.price || listing?.price || null,
        priceValue,
        priceCurrency: detail?.priceCurrency || null,
        address,
        streetAddress: detail?.streetAddress || null,
        locality: detail?.locality || listing?.locality || null,
        region: detail?.region || null,
        postalCode: detail?.postalCode || listing?.postalCode || extractUkPostcode(address),
        country: detail?.country || null,
        propertyType: detail?.propertyType || listing?.propertyType || null,
        beds: detail?.beds ?? listing?.beds ?? null,
        baths: detail?.baths ?? listing?.baths ?? null,
        floorArea: detail?.floorArea || null,
        tenure: detail?.tenure || null,
        description: detail?.description || null,
        features: detail?.features || null,
        images: detail?.images || null,
        agentName: detail?.agentName || null,
        agentUrl: detail?.agentUrl || null,
        latitude: detail?.latitude ?? listing?.latitude ?? null,
        longitude: detail?.longitude ?? listing?.longitude ?? null,
        source,
        scrapedAt: new Date().toISOString(),
    };
};

const fetchListingsViaApi = async ({ startUrl, page, pageSize, proxyConfiguration }) => {
    const candidates = buildApiCandidates({ startUrl, page, pageSize });

    for (const candidate of candidates) {
        const response = await requestPage({
            url: candidate.url,
            proxyConfiguration,
            headers: JSON_HEADERS,
            responseType: 'text',
            referer: startUrl,
        });

        if (response.statusCode !== 200 || !response.body) {
            log.debug(`API ${candidate.name} returned ${response.statusCode} for ${candidate.url}`);
            continue;
        }
        const payload = typeof response.body === 'string' ? safeParseJson(response.body) : response.body;
        if (!payload) continue;

        const listings = extractListingsFromApiResponse(payload);
        if (listings.length) {
            return { listings, endpoint: candidate.name };
        }
    }

    return { listings: [], endpoint: null };
};

const fetchListingsViaHtml = async ({ url, proxyConfiguration }) => {
    const response = await requestPage({ url, proxyConfiguration, responseType: 'text', referer: url });
    if (response.statusCode !== 200 || !response.body) return [];
    return extractListingsFromHtml(response.body);
};

const fetchListingDetail = async ({ url, proxyConfiguration }) => {
    if (!url) return null;
    const response = await requestPage({ url, proxyConfiguration, responseType: 'text', referer: BASE_URL });
    if (response.statusCode !== 200 || !response.body) return null;
    return parseDetailHtml(response.body);
};

const fetchSitemapUrls = async ({ limit, proxyConfiguration }) => {
    const sitemapCandidates = [
        `${BASE_URL}/sitemap.xml`,
        `${BASE_URL}/sitemap-index.xml`,
        `${BASE_URL}/sitemap/sales.xml`,
        `${BASE_URL}/sitemap/for-sale.xml`,
    ];

    const listingUrls = new Set();

    const collectFromSitemap = async (sitemapUrl) => {
        const response = await requestPage({ url: sitemapUrl, proxyConfiguration, responseType: 'text', referer: BASE_URL });
        if (response.statusCode !== 200 || !response.body) return;

        const $ = cheerioLoad(response.body, { xmlMode: true });
        const isIndex = $('sitemapindex').length > 0;

        if (isIndex) {
            const nested = $('sitemap > loc')
                .map((_, el) => $(el).text().trim())
                .get();

            for (const nestedUrl of nested) {
                if (listingUrls.size >= limit) break;
                await collectFromSitemap(nestedUrl);
            }
            return;
        }

        $('url > loc').each((_, el) => {
            const loc = $(el).text().trim();
            if (!loc) return;
            if (!/\/for-sale\/details\//.test(loc) && !/\/for-sale\/property\/[^/]+\/\d+/i.test(loc)) return;
            listingUrls.add(loc);
            if (listingUrls.size >= limit) return false;
            return undefined;
        });
    };

    for (const sitemapUrl of sitemapCandidates) {
        if (listingUrls.size >= limit) break;
        await collectFromSitemap(sitemapUrl);
    }

    return Array.from(listingUrls).slice(0, limit);
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};

    const startUrls = Array.isArray(input.startUrls) && input.startUrls.length ? input.startUrls : null;
    const startUrl = input.startUrl || (startUrls ? null : DEFAULT_START_URL);

    const hasInputError = !startUrl && !startUrls;
    if (hasInputError) {
        const message = 'Missing required field: startUrl or startUrls.';
        log.error(message);
        await Actor.setStatusMessage(message);
        await Actor.setValue('INPUT_VALIDATION_ERROR', { message, timestamp: new Date().toISOString() });
    }

    if (!hasInputError) {
        const resultsWanted = Math.max(1, Number.isFinite(+input.results_wanted) ? +input.results_wanted : 50);
        const maxPages = Math.max(1, Number.isFinite(+input.max_pages) ? +input.max_pages : 3);
        const pageSize = DEFAULT_PAGE_SIZE;
        const collectDetails = input.collectDetails !== false;
        const maxConcurrency = DEFAULT_MAX_CONCURRENCY;
        const useJsonApi = ENABLE_JSON_API;
        const useHtmlFallback = ENABLE_HTML_FALLBACK;
        const useSitemap = ENABLE_SITEMAP_FALLBACK;

        const proxyConf = input.proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...input.proxyConfiguration })
            : undefined;

        const targets = startUrls || [startUrl];

        const seen = new Set();
        const limiter = createLimiter(maxConcurrency);
        const errorLog = [];
        const stats = { pagesProcessed: 0, listingsSaved: 0, methodsUsed: [] };

        let saved = 0;

        for (const target of targets) {
            if (saved >= resultsWanted) break;
            log.info(`Starting search: ${target}`);

            if (useJsonApi) {
                for (let page = 1; page <= maxPages && saved < resultsWanted; page += 1) {
                    try {
                        const apiResult = await fetchListingsViaApi({
                            startUrl: target,
                            page,
                            pageSize,
                            proxyConfiguration: proxyConf,
                        });

                        if (!apiResult.listings.length) {
                            break;
                        }

                        if (!stats.methodsUsed.includes('json-api')) stats.methodsUsed.push('json-api');

                        const tasks = apiResult.listings.map((listing) =>
                            limiter(async () => {
                                if (saved >= resultsWanted) return;
                                const key = listing.listingId || listing.url;
                                if (!key || seen.has(key)) return;
                                seen.add(key);

                                let detail = null;
                                if (collectDetails && listing.url) {
                                    detail = await fetchListingDetail({ url: listing.url, proxyConfiguration: proxyConf });
                                }

                                const property = buildProperty({ listing, detail, source: 'json-api' });
                                await Dataset.pushData(property);
                                saved += 1;
                                stats.listingsSaved = saved;
                            })
                        );

                        await Promise.all(tasks);
                        stats.pagesProcessed += 1;
                    } catch (err) {
                        errorLog.push({
                            timestamp: new Date().toISOString(),
                            method: 'json-api',
                            page,
                            error: err.message,
                        });
                        break;
                    }
                }
            }

            if (saved < resultsWanted && useHtmlFallback) {
                for (let page = 1; page <= maxPages && saved < resultsWanted; page += 1) {
                    const pageUrl = buildSearchUrlForPage(target, page);
                    try {
                        const listings = await fetchListingsViaHtml({ url: pageUrl, proxyConfiguration: proxyConf });
                        if (!listings.length) break;

                        if (!stats.methodsUsed.includes('html')) stats.methodsUsed.push('html');

                        const tasks = listings.map((listing) =>
                            limiter(async () => {
                                if (saved >= resultsWanted) return;
                                const key = listing.listingId || listing.url;
                                if (!key || seen.has(key)) return;
                                seen.add(key);

                                let detail = null;
                                if (collectDetails && listing.url) {
                                    detail = await fetchListingDetail({ url: listing.url, proxyConfiguration: proxyConf });
                                }

                                const property = buildProperty({ listing, detail, source: 'html' });
                                await Dataset.pushData(property);
                                saved += 1;
                                stats.listingsSaved = saved;
                            })
                        );

                        await Promise.all(tasks);
                        stats.pagesProcessed += 1;
                    } catch (err) {
                        errorLog.push({
                            timestamp: new Date().toISOString(),
                            method: 'html',
                            page,
                            error: err.message,
                        });
                        break;
                    }
                }
            }

            if (saved < resultsWanted && useSitemap) {
                try {
                    const sitemapUrls = await fetchSitemapUrls({
                        limit: resultsWanted - saved,
                        proxyConfiguration: proxyConf,
                    });

                    if (sitemapUrls.length) {
                        if (!stats.methodsUsed.includes('sitemap')) stats.methodsUsed.push('sitemap');

                        const tasks = sitemapUrls.map((url) =>
                            limiter(async () => {
                                if (saved >= resultsWanted) return;
                                const key = extractListingId(url) || url;
                                if (seen.has(key)) return;
                                seen.add(key);

                                const detail = await fetchListingDetail({ url, proxyConfiguration: proxyConf });
                                const property = buildProperty({ listing: { url }, detail, source: 'sitemap' });
                                await Dataset.pushData(property);
                                saved += 1;
                                stats.listingsSaved = saved;
                            })
                        );

                        await Promise.all(tasks);
                    }
                } catch (err) {
                    errorLog.push({
                        timestamp: new Date().toISOString(),
                        method: 'sitemap',
                        error: err.message,
                    });
                }
            }
        }

        if (errorLog.length) {
            await Actor.setValue('ERROR_LOG', errorLog);
        }

        if (saved === 0) {
            const message = BLOCK_EVENTS.length
                ? 'No listings were scraped. Requests appear blocked; use residential proxies or rotate IPs.'
                : 'No listings were scraped. Review the logs for details.';
            log.warning(message);
            await Actor.setStatusMessage(message);
            if (BLOCK_EVENTS.length) {
                await Actor.setValue('BLOCKED_REQUESTS', BLOCK_EVENTS);
            }
        } else {
            log.info(`Saved ${saved} listings.`);
            await Actor.setValue('RUN_SUMMARY', {
                listingsSaved: saved,
                pagesProcessed: stats.pagesProcessed,
                methodsUsed: stats.methodsUsed,
            });
        }
    }
} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}
