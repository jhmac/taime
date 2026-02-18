# AI Scheduler - Shopify Sales-Based Staffing

## Overview
The AI Scheduler uses historical Shopify sales data to intelligently recommend staffing levels for upcoming shifts. By analyzing year-over-year sales patterns, seasonal trends, and day-of-week behaviors, the system helps managers schedule the right number of employees to match expected customer demand.

## How It Works

### Data Flow
1. **Shopify Sales Sync** - Sales data is pulled from the connected Shopify store and stored locally in daily aggregations (revenue, order count, item count, average order value)
2. **Year-over-Year Comparison** - For any date range being scheduled, the system pulls sales from the same period last year to establish baseline expectations
3. **AI Analysis** - Claude AI analyzes the historical sales patterns, trends, and anomalies to generate specific staffing recommendations
4. **Schedule Integration** - Recommendations are surfaced directly in the Schedule Management page for easy application

### Key Features
- **Date-specific recommendations**: Pick any upcoming date or week and get staffing suggestions based on what happened on those same days last year
- **YoY trend analysis**: See if sales are trending up or down compared to last year so staffing can be adjusted accordingly
- **Day-of-week patterns**: Automatically identifies your busiest and slowest days
- **Per-day headcount**: Get specific employee count recommendations for each day, not just vague staffing levels
- **AI reasoning**: Every recommendation comes with an explanation of why that staffing level is suggested

## Architecture

### Database
- `shopify_daily_sales` - Stores aggregated daily sales data per shop (revenue, orders, items, day of week)
- `shops` - Connected Shopify stores with OAuth tokens
- `user_shops` - Links users to their authorized shops

### API Endpoints

#### Existing
- `POST /api/shopify/sync-sales` - Syncs orders from Shopify and aggregates into daily sales
- `GET /api/shopify/sales-data` - Returns daily sales data with weekday analysis
- `GET /api/shopify/staffing-recommendations` - Basic staffing level recommendations
- `GET /api/shopify/labor-cost-ratio` - Labor cost as percentage of revenue

#### New (AI Scheduler)
- `GET /api/shopify/yoy-comparison` - Year-over-year sales comparison for a date range
  - Params: `shop` (domain), `startDate`, `endDate`
  - Returns: Current year sales, previous year sales, growth trends, daily breakdown
- `GET /api/shopify/ai-staffing` - AI-powered staffing recommendations using YoY data
  - Params: `shop` (domain), `startDate`, `endDate`
  - Returns: Per-day employee count recommendations with AI reasoning, confidence levels, and supporting data

### Frontend Components
- **Sales-Based Staffing Panel** in Schedule Management page
  - Date range picker for the scheduling period
  - YoY sales comparison chart (bar chart showing this year vs last year)
  - AI staffing recommendations table with per-day headcount
  - Visual indicators for high/normal/low staffing days

## Roadmap

### Phase 1: YoY Sales Comparison (Backend)
- Build endpoint to query sales data for selected dates and same dates from previous year
- Calculate daily and period-level growth trends
- Handle edge cases: missing data, leap years, holidays

### Phase 2: AI Staffing Engine (Backend)
- Enhanced AI prompt with YoY context, team size, and business rules
- Per-day staffing recommendations with specific employee counts
- Confidence scoring based on data availability and consistency

### Phase 3: Schedule Management UI (Frontend)
- Date/range picker integrated into Schedule Management page
- Visual YoY comparison chart using Recharts
- AI recommendation cards with headcount per day
- Loading states and error handling

### Phase 4: Testing & Refinement
- End-to-end testing with real Shopify data
- Edge case handling (no data, partial data, anomalous days)
- Performance optimization for large date ranges

## Technical Notes
- Sales data sync supports up to 365 days of history (configurable)
- AI uses Claude claude-sonnet-4-20250514 for staffing analysis
- Rate limiting: 10 AI requests per minute per user
- Token encryption for stored Shopify access tokens
