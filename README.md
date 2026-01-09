# Zoopla Property Listings Scraper

<!-- Apify Badges Section -->
<div align="center">

[![Apify actors](https://actors-badge.apifyusercontent.com/lxA-a2zGaoqhO2cfqYvpQcuWj5S-hlBqBqGPnM3i6E5uoeU5.svg?name=Zoopla%20Scraper&size=large)](https://apify.com/shahidirfan100/zoopla-scraper)
[![Version](https://img.shields.io/badge/Version-2.1.0-blue)](https://github.com/shahidirfan100/Zoopla-Scraper)
[![License](https://img.shields.io/badge/License-ISC-green)](LICENSE)

</div>

---

## 📋 Description

**Zoopla Property Listings Scraper** is a powerful Apify actor designed to extract comprehensive property data from Zoopla.co.uk, the leading UK property portal. This scraper efficiently collects property listings including prices, addresses, specifications, agent information, and high-quality images for real estate analysis, market research, property investment research, and competitive intelligence.

The actor handles pagination automatically and provides structured, clean data ready for analysis or integration into your applications. Whether you're building a property database, conducting market research, or monitoring real estate trends, this scraper delivers reliable results with minimal configuration.

---

## 🎯 Use Cases

This scraper is ideal for various real estate and data applications:

- **Real Estate Market Research** — Analyze UK property prices, trends, and market conditions across different regions and property types.
- **Property Investment Analysis** — Collect comprehensive property data to identify investment opportunities and evaluate property values.
- **Estate Agent Lead Generation** — Build databases of property listings with agent contact information for business development.
- **Property Comparison Tools** — Aggregate listing data to create comparison platforms and property search engines.
- **Academic and Data Science Projects** — Obtain clean, structured property data for research and machine learning applications.
- **Property Portal Development** — Seed databases with existing listings when building new property platforms.
- **Price Monitoring** — Track price changes over time for specific areas or property types.

---

## 🚀 Getting Started

### Quick Start

1. Open the actor page on [Apify](https://apify.com/shahidirfan100/zoopla-scraper)
2. Click **Try it out** to run with default settings
3. Configure input parameters as needed
4. Click **Run** to start the scraping job

### Prerequisites

- An [Apify account](https://apify.com/sign-up) with available compute units
- UK residential proxies recommended for optimal success rate (see [Proxy Configuration](#-proxy-configuration))

---

## ⚙️ Input Configuration

Configure the scraper using the following parameters. All parameters are optional — the scraper will use sensible defaults if not specified.

### Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | string | No | Zoopla London listings | Single Zoopla search URL to scrape. Must be a valid Zoopla.co.uk URL. |
| `startUrls` | array | No | — | Array of multiple URLs to crawl in a single run. Overrides `startUrl`. |
| `results_wanted` | integer | No | 50 | Maximum number of property listings to collect. Range: 1-500. |
| `max_pages` | integer | No | 5 | Maximum number of pages to scrape per URL. Each page typically contains 25 listings. |
| `maxConcurrency` | integer | No | 2 | Number of concurrent browser pages. Lower values increase reliability but reduce speed. |
| `proxyConfiguration` | object | No | UK Residential | Proxy settings for making requests (see below). |

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

### URL Examples

Get started with these URL patterns:

| Search Type | URL Pattern |
|-------------|-------------|
| Properties for sale | `https://www.zoopla.co.uk/for-sale/property/{location}/` |
| Properties to rent | `https://www.zoopla.co.uk/to-rent/property/{location}/` |
| New homes | `https://www.zoopla.co.uk/new-homes/for-sale/{location}/` |

---

## 📊 Output Structure

The scraper returns a comprehensive JSON array containing detailed property information. Each listing includes multiple data points for complete property analysis.

### Data Fields

| Field | Type | Description |
|-------|------|-------------|
| `listingId` | string | Unique Zoopla listing identifier |
| `url` | string | Direct URL to the property listing page |
| `title` | string | Property title or listing headline |
| `price` | number | Asking price in numeric format (GBP) |
| `priceValue` | number | Numeric price value for calculations |
| `priceCurrency` | string | Currency code (always "GBP") |
| `priceText` | string | Formatted price string (e.g., "£325,000") |
| `address` | string | Full property address |
| `postalCode` | string | UK postal code |
| `locality` | string | Town or city name |
| `beds` | number | Number of bedrooms |
| `baths` | number | Number of bathrooms |
| `propertyType` | string | Property type (Flat, House, Bungalow, etc.) |
| `description` | string | Full property description text |
| `image` | string | URL to main property image |
| `agentName` | string | Listing estate agent or property developer |
| `source` | string | Data extraction method identifier |
| `scrapedAt` | string | ISO 8601 timestamp of extraction |

### Example Output

```json
[
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
    "description": "Stunning two-bedroom first-floor period conversion apartment with original features throughout.",
    "image": "https://lid.zoocdn.com/u/2400/1800/a1b2c3d4.jpg",
    "agentName": "Barnard Marcus",
    "source": "json-ld",
    "scrapedAt": "2026-01-07T11:00:00.000Z"
  }
]
```

---

## 🔧 Proxy Configuration

Proper proxy configuration is essential for reliable data extraction. Zoopla implements protection measures that require appropriate proxy setup.

### Recommended Configuration

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "GB"
  }
}
```

### Proxy Type Comparison

| Proxy Type | Success Rate | Notes |
|------------|--------------|-------|
| UK Residential | **High** | Recommended for best results |
| Residential (other) | Medium | May work with reduced success |
| Datacenter | Low | Not recommended, high failure rate |
| No proxy | Very Low | Will likely fail |

> **Important**: Residential proxies with UK (`countryCode: "GB"`) geolocation provide the highest success rate. Using datacenter proxies or proxies without country specification will significantly reduce reliability.

---

## ⚡ Performance Tips

Optimize your scraping runs with these recommendations:

- **Limit results per run**: For best reliability, keep `results_wanted` under 200 listings
- **Reduce concurrency**: Lower `maxConcurrency` to 1-2 for improved success rate
- **Balance pages and results**: Fewer pages with more results per page is more efficient
- **Monitor usage**: Large scraping jobs consume more compute units

---

## ❓ Frequently Asked Questions

<details>
<summary>How long does a typical scraping job take?</summary>

A job processing 100 listings typically completes in 3-5 minutes. Larger jobs scale proportionally based on results wanted and pages to scrape.
</details>

<details>
<summary>What happens if a request fails?</summary>

The actor implements robust error handling and automatic retries. Failed requests are logged, and the scraping continues with remaining URLs. Check the run log for specific error details.
</details>

<details>
<summary>Can I scrape Zoopla without proxies?</summary>

While technically possible, running without proxies or using datacenter proxies will result in very low success rates. UK residential proxies are strongly recommended for consistent results.
</details>

<details>
<summary>Is this scraper legal to use?</summary>

The scraper extracts publicly available data from Zoopla's website. Users are responsible for ensuring compliance with Zoopla's terms of service and applicable data protection regulations including GDPR when processing personal data.
</details>

<details>
<summary>Can I schedule automated scraping?</summary>

Yes, Apify supports scheduling through its platform. You can set up recurring runs for monitoring property listings over time.
</details>

<details>
<summary>How fresh is the data?</summary>

Data is extracted in real-time during each run. For monitoring purposes, schedule regular runs to capture the most current listings and price changes.
</details>

<details>
<summary>What output formats are supported?</summary>

The primary output is JSON format. Apify also supports automatic export to CSV, Excel, and other formats through its built-in storage and export features.
</details>

<details>
<summary>Are property images included?</summary>

The scraper captures the main property image URL. Full image downloads would require additional processing or separate scraping.
</details>

---

## 🛠️ Troubleshooting

### Common Issues and Solutions

#### Request Blocked or Access Denied
- Verify proxy configuration uses UK residential proxies
- Reduce `maxConcurrency` to 1
- Decrease `results_wanted` and `max_pages`
- Wait several minutes before retrying

#### Empty or Incomplete Data
- Some fields may be empty if not provided by the listing
- Zoopla listings vary in completeness
- The scraper captures all available data for each property

#### Timeout Errors
- Reduce the number of concurrent requests
- Limit `results_wanted` to a smaller number
- Increase timeout settings in your Apify run configuration

#### Slow Performance
- Increase `maxConcurrency` (up to 5) for faster scraping
- Reduce `max_pages` if not all pages are needed
- Consider running multiple smaller jobs instead of one large job

---

## 📈 Related Actors

Explore other Apify actors for extended functionality:

- [Rightmove Scraper](https://apify.com/) — Extract Rightmove property listings
- [OnTheMarket Scraper](https://apify.com/) — Collect OnTheMarket property data
- [UK Property Data Aggregator](https://apify.com/) — Combine multiple UK property sources

---

## 📄 Changelog

### Version 2.1.0
- Enhanced data extraction with improved field coverage
- Optimized pagination handling for large result sets
- Better error recovery and retry mechanisms
- Improved output data structure

### Version 2.0.0
- Major architecture improvements
- Enhanced data completeness
- Improved reliability and error handling

### Version 1.0.0
- Initial release
- Basic property data extraction

---

## 📝 License

This project is licensed under the ISC License. See the [LICENSE](LICENSE) file for details.

---

## 🤝 Support and Contributing

### Getting Help
- Check the [Apify documentation](https://docs.apify.com/) for platform guides
- Review the [Troubleshooting](#-troubleshooting) section above
- Search existing issues on the [GitHub repository](https://github.com/shahidirfan100/Zoopla-Scraper)

### Contributing
Contributions are welcome! Please feel free to submit issues and pull requests on the GitHub repository.

---

<div align="center">

**Built for Apify** — The scalable web scraping platform

</div>
