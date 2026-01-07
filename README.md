# Zoopla Property Scraper

Fast, stealthy Apify actor for scraping property listings from Zoopla UK. Extracts property data using JSON-LD structured data for maximum reliability and speed.

## Features

- 🚀 **Fast** - Uses CheerioCrawler for HTTP-only scraping (no browser overhead)
- 🔒 **Stealthy** - Implements Apify best practices for anti-bot bypass
- 📊 **Structured Data** - Extracts from JSON-LD for reliable, clean data
- 🇬🇧 **UK Optimized** - Configured with UK residential proxies by default
- 📄 **Pagination** - Automatically handles multiple search pages

## Input

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `startUrl` | string | Zoopla search URL to scrape | London properties |
| `startUrls` | array | Multiple search URLs to crawl | - |
| `results_wanted` | integer | Maximum listings to collect (1-1000) | 50 |
| `max_pages` | integer | Maximum pages per search URL | 10 |
| `collectDetails` | boolean | Visit detail pages for full descriptions | false |
| `proxyConfiguration` | object | Proxy settings (residential recommended) | UK residential |

### Example Input

```json
{
  "startUrl": "https://www.zoopla.co.uk/for-sale/property/london/",
  "results_wanted": 100,
  "max_pages": 10,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "GB"
  }
}
```

## Output

Each property listing includes:

| Field | Type | Description |
|-------|------|-------------|
| `listingId` | string | Unique Zoopla listing ID |
| `url` | string | Full URL to the property page |
| `title` | string | Property title/name |
| `price` | number | Asking price |
| `priceValue` | number | Numeric price value |
| `priceCurrency` | string | Currency (GBP) |
| `address` | string | Property address |
| `postalCode` | string | UK postal code |
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
  "address": "Birdhurst Rise, South Croydon CR2",
  "postalCode": "CR2",
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

## How It Works

1. **JSON-LD Extraction (Primary)** - Parses structured `application/ld+json` data embedded in search pages
2. **HTML Enrichment** - Supplements JSON-LD with additional fields from HTML (beds, baths)
3. **Stealth Headers** - Uses realistic browser headers with `sec-ch-*` client hints
4. **UK Proxies** - Routes requests through UK residential IP addresses

## Proxy Recommendations

For best results, use **UK Residential proxies**:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "GB"
  }
}
```

## Limitations

- Zoopla uses Cloudflare protection which may occasionally block requests
- Detail page scraping (`collectDetails: true`) has higher block rates
- For maximum reliability, keep `results_wanted` under 500 per run

## Changelog

### v2.0.0
- Complete rewrite using CheerioCrawler (faster, no browser)
- JSON-LD extraction as primary data source
- Added stealth headers with sec-ch-* client hints
- UK residential proxy configuration by default
- Removed non-functional API endpoint guessing
- Simplified dependencies (removed Playwright, Camoufox)

### v1.0.0
- Initial release with Playwright + Camoufox

## License

ISC
