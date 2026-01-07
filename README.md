# Zoopla Property Scraper

Stealthy Apify actor for scraping property listings from Zoopla UK. Uses **PlaywrightCrawler with Camoufox** for maximum stealth against Cloudflare protection.

## Features

- 🔒 **Maximum Stealth** - Uses Camoufox (anti-detect Firefox) to bypass Cloudflare
- 🇬🇧 **UK Optimized** - Configured with UK residential proxies by default
- 📊 **Dual Extraction** - Combines JSON-LD structured data + HTML parsing for complete data
- 🔄 **Human-like Behavior** - Random delays, scrolling, and session management
- 📄 **Auto Pagination** - Handles multiple search pages automatically

## How It Works

1. **PlaywrightCrawler + Camoufox** - Uses stealth Firefox browser to bypass Cloudflare
2. **JSON-LD Extraction** - Parses `application/ld+json` structured data for reliable fields
3. **HTML Fallback** - Supplements with HTML parsing using `data-testid` selectors
4. **Data Merging** - Combines both sources for maximum data completeness

## Input

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `startUrl` | string | Zoopla search URL to scrape | London properties |
| `startUrls` | array | Multiple search URLs to crawl | - |
| `results_wanted` | integer | Maximum listings to collect (1-500) | 50 |
| `max_pages` | integer | Maximum pages per search URL | 5 |
| `maxConcurrency` | integer | Concurrent browser pages (lower = stealthier) | 2 |
| `proxyConfiguration` | object | **REQUIRED**: UK residential proxies | UK RESIDENTIAL |

### Example Input

```json
{
  "startUrl": "https://www.zoopla.co.uk/for-sale/property/london/",
  "results_wanted": 100,
  "max_pages": 5,
  "maxConcurrency": 2,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "GB"
  }
}
```

> ⚠️ **Important**: RESIDENTIAL proxies with `countryCode: "GB"` are strongly recommended. Datacenter proxies will likely be blocked by Cloudflare.

## Output

Each property listing includes:

| Field | Type | Description |
|-------|------|-------------|
| `listingId` | string | Unique Zoopla listing ID |
| `url` | string | Full URL to the property page |
| `title` | string | Property title/name |
| `price` | number | Asking price (numeric) |
| `priceValue` | number | Numeric price value |
| `priceCurrency` | string | Currency (GBP) |
| `priceText` | string | Formatted price text |
| `address` | string | Property address |
| `postalCode` | string | UK postal code |
| `locality` | string | Town/city |
| `beds` | number | Number of bedrooms |
| `baths` | number | Number of bathrooms |
| `propertyType` | string | Type of property |
| `description` | string | Property description |
| `image` | string | Main property image URL |
| `agentName` | string | Estate agent name |
| `source` | string | Data extraction method used |
| `scrapedAt` | string | Timestamp of extraction |

### Example Output

```json
{
  "listingId": "72064206",
  "url": "https://www.zoopla.co.uk/for-sale/details/72064206/",
  "title": "2 bed flat for sale",
  "price": 325000,
  "priceValue": 325000,
  "priceCurrency": "GBP",
  "priceText": "£325,000",
  "address": "Birdhurst Rise, South Croydon CR2",
  "postalCode": "CR2",
  "locality": "London",
  "beds": 2,
  "baths": 1,
  "propertyType": "Flat",
  "description": "Stunning two-bedroom first-floor period conversion apartment...",
  "image": "https://lid.zoocdn.com/u/2400/1800/...",
  "agentName": "Barnard Marcus",
  "source": "json-ld",
  "scrapedAt": "2026-01-07T11:00:00.000Z"
}
```

## Stealth Techniques Used

This actor implements multiple stealth techniques:

1. **Camoufox** - Anti-detect Firefox with fingerprint injection
2. **UK Residential Proxies** - Geo-matched IP addresses
3. **Human-like Delays** - Random pauses between actions
4. **Scrolling Simulation** - Triggers lazy loading like a real user
5. **Browser Session Management** - Retires browsers after limited use
6. **Stealth Scripts** - Overrides `navigator.webdriver` and other signals

## Proxy Requirements

| Proxy Type | Success Rate | Recommendation |
|------------|--------------|----------------|
| RESIDENTIAL + GB | ✅ High | **Recommended** |
| RESIDENTIAL (no country) | ⚠️ Medium | May work |
| DATACENTER | ❌ Low | Will likely fail |
| No proxy | ❌ Very Low | Will fail |

## Limitations

- Zoopla uses aggressive Cloudflare protection
- Some requests may still be blocked; the actor handles this gracefully
- For best results, keep `results_wanted` under 200 per run
- Lower `maxConcurrency` (1-2) is more reliable but slower

## Troubleshooting

### "Request blocked" errors
- Ensure you're using RESIDENTIAL proxies with `countryCode: "GB"`
- Reduce `maxConcurrency` to 1
- Reduce `results_wanted` and `max_pages`

### Empty or null fields
- JSON-LD may not include all fields; HTML parsing supplements this
- Some listings may have incomplete data on Zoopla itself

### Timeout errors
- Increase timeout or reduce concurrency
- Cloudflare challenges take time to resolve

## Changelog

### v2.1.0
- Complete rewrite with PlaywrightCrawler + Camoufox
- Correct `data-testid` selectors from live research
- Dual extraction: JSON-LD + HTML with data merging
- Human-like scrolling and delays
- Browser session management

### v2.0.0
- CheerioCrawler approach (deprecated - blocked by Cloudflare)

### v1.0.0
- Initial release with Playwright + Camoufox

## License

ISC
