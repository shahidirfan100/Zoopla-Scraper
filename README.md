# Zoopla Property Scraper

Extract UK property listings, pricing, and detail data from Zoopla. This actor prioritizes JSON endpoints for speed, then falls back to HTML parsing and JSON-LD for reliability, with optional sitemap discovery to maximize coverage.

## Use cases

- Property market research and analytics
- Price tracking for houses and apartments
- Lead generation for agencies and investors
- Portfolio monitoring and trend analysis
- Data enrichment for real estate platforms

## What the actor collects

- Listing ID and URL
- Title and address
- Price and currency
- Bedrooms and bathrooms
- Property type and tenure
- Description and key features
- Images and agent details
- Location coordinates (when available)

## How it works

1. JSON API requests (fastest)
2. HTML search parsing (fallback)
3. JSON-LD extraction on detail pages (structured data)
4. Sitemap discovery (optional fallback)

Concurrency, API page size, and fallback order are fixed internally for stability.

## Quick start

Basic input:

```json
{
  "startUrl": "https://www.zoopla.co.uk/for-sale/property/london/?q=London&search_source=home&recent_search=true",
  "results_wanted": 50,
  "collectDetails": true
}
```

High coverage input:

```json
{
  "startUrls": [
    "https://www.zoopla.co.uk/for-sale/property/london/?q=London&search_source=home&recent_search=true",
    "https://www.zoopla.co.uk/for-sale/property/manchester/?q=Manchester&search_source=home"
  ],
  "results_wanted": 200,
  "max_pages": 5,
  "collectDetails": true,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Input configuration

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Default</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>startUrl</code></td>
<td>string</td>
<td>London search</td>
<td>Single Zoopla for-sale search URL.</td>
</tr>
<tr>
<td><code>startUrls</code></td>
<td>array</td>
<td>empty</td>
<td>Optional list of search URLs to crawl.</td>
</tr>
<tr>
<td><code>results_wanted</code></td>
<td>integer</td>
<td>50</td>
<td>Maximum number of listings to collect.</td>
</tr>
<tr>
<td><code>max_pages</code></td>
<td>integer</td>
<td>3</td>
<td>Maximum search pages to process per URL.</td>
</tr>
<tr>
<td><code>collectDetails</code></td>
<td>boolean</td>
<td>true</td>
<td>Visit listing detail pages for full data.</td>
</tr>
<tr>
<td><code>proxyConfiguration</code></td>
<td>object</td>
<td>Apify Proxy</td>
<td>Recommended for higher success rates.</td>
</tr>
</tbody>
</table>

## Output example

```json
{
  "listingId": "12345678",
  "url": "https://www.zoopla.co.uk/for-sale/details/12345678/",
  "title": "2 bed flat for sale",
  "price": "GBP 475,000",
  "priceValue": 475000,
  "priceCurrency": "GBP",
  "address": "Shoreditch, London E1",
  "postalCode": "E1",
  "propertyType": "Apartment",
  "beds": 2,
  "baths": 1,
  "tenure": "Leasehold",
  "description": "Spacious modern apartment in central London...",
  "features": ["Balcony", "Lift", "Concierge"],
  "images": ["https://..."],
  "agentName": "Example Estate Agents",
  "agentUrl": "https://www.zoopla.co.uk/find-agents/estate-agents/",
  "source": "json-api",
  "scrapedAt": "2026-01-07T10:30:00.000Z"
}
```

## Pagination notes

Zoopla search pages typically use the <code>pn</code> query parameter. The actor automatically paginates up to <code>max_pages</code> and stops when it reaches <code>results_wanted</code>.

## Tips for best results

- Use multiple targeted search URLs to capture more local coverage.
- Keep concurrency moderate (2-5) for stability.
- Use proxy configuration for consistent access.
- Enable <code>collectDetails</code> if you need descriptions, images, and structured fields.

## SEO keywords

Zoopla scraper, UK property listings, real estate data, houses for sale, apartments, property prices, London property data, UK housing market, property analytics, real estate listings.

## Support

If you encounter empty results, reduce concurrency, verify the search URL, and review the run logs for diagnostics.
