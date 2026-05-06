const SHOPIFY_API_VERSION = '2026-04';

export interface ShopifyOrder {
  id: string;
  name: string;
  createdAt: string;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  subtotalPriceSet?: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  lineItems: {
    nodes: Array<{
      title: string;
      quantity: number;
      variant?: {
        price: string;
        product?: {
          id: string;
          title: string;
        };
      };
    }>;
  };
}

export interface ShopifyLocation {
  id: string;
  name: string;
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
    phone?: string;
  };
  phone?: string;
}

export class ShopifyService {
  private shopDomain: string;
  private accessToken: string;

  constructor(shopDomain: string, accessToken: string) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
  }

  async initialize(): Promise<{ success: boolean; shopName?: string; email?: string }> {
    if (!this.shopDomain || !this.accessToken) {
      return { success: false };
    }
    try {
      const response = await this.makeGraphQLRequest(`{
        shop {
          name
          email
        }
      }`);
      if (response.data?.shop?.name) {
        return { success: true, shopName: response.data.shop.name, email: response.data.shop.email };
      }
      return { success: false };
    } catch (error) {
      console.error('[ShopifyService] Initialization failed:', error);
      return { success: false };
    }
  }

  async makeGraphQLRequest(query: string, variables?: Record<string, any>): Promise<any> {
    const url = `https://${this.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`Shopify GraphQL error: ${data.errors[0]?.message || 'Unknown error'}`);
    }
    return data;
  }

  async getShopInfo(): Promise<any> {
    const query = `{
      shop {
        name
        email
        myshopifyDomain
        primaryDomain {
          url
        }
        currencyCode
        timezoneAbbreviation
        ianaTimezone
        plan {
          displayName
        }
        createdAt
      }
    }`;
    return (await this.makeGraphQLRequest(query)).data?.shop;
  }

  async getOrders(filters: {
    first?: number;
    createdAtMin?: string;
    createdAtMax?: string;
    maxPages?: number;
    after?: string;
  } = {}): Promise<ShopifyOrder[]> {
    const { first = 50, createdAtMin, createdAtMax, maxPages = 10 } = filters;
    let queryFilter = '';
    const filterParts: string[] = [];

    // Preserve full ISO-8601 instants (Shopify GraphQL search supports
    // timestamp granularity in the created_at filter). Truncating to
    // YYYY-MM-DD breaks shop-timezone bucketing for non-UTC stores.
    if (createdAtMin) {
      filterParts.push(`created_at:>='${createdAtMin}'`);
    }
    if (createdAtMax) {
      filterParts.push(`created_at:<='${createdAtMax}'`);
    }
    if (filterParts.length > 0) {
      queryFilter = filterParts.join(' ');
    }

    const graphqlQuery = `
      query GetOrders($first: Int!, $query: String, $after: String) {
        orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true, after: $after) {
          nodes {
            id
            name
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            displayFinancialStatus
            displayFulfillmentStatus
            lineItems(first: 10) {
              nodes {
                title
                quantity
                variant {
                  price
                  product {
                    id
                    title
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const allOrders: ShopifyOrder[] = [];
    let cursor: string | null = null;
    let pageCount = 0;

    try {
      do {
        pageCount++;
        const variables: Record<string, any> = { first };
        if (queryFilter) variables.query = queryFilter;
        if (cursor) variables.after = cursor;

        const response = await this.makeGraphQLRequest(graphqlQuery, variables);
        const orders = response.data?.orders?.nodes || [];
        const pageInfo = response.data?.orders?.pageInfo;

        allOrders.push(...orders);

        if (pageInfo?.hasNextPage && pageInfo?.endCursor && pageCount < maxPages) {
          cursor = pageInfo.endCursor;
        } else {
          cursor = null;
        }
      } while (cursor);

      return allOrders;
    } catch (error) {
      console.error('Error fetching orders:', error);
      return allOrders;
    }
  }

  async getSalesSummary(options: { daysBack?: number } = {}): Promise<{
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
    currency: string;
    periodStart: string;
    periodEnd: string;
    topProducts: Array<{ title: string; quantity: number; revenue: number }>;
  }> {
    const { daysBack = 30 } = options;
    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const createdAtMin = startDate.toISOString();
    const createdAtMax = now.toISOString();

    const orders = await this.getOrders({ first: 250, createdAtMin, createdAtMax });

    let totalRevenue = 0;
    let currency = 'USD';
    const productSales: Record<string, { title: string; quantity: number; revenue: number }> = {};

    for (const order of orders) {
      const orderTotal = parseFloat(order.totalPriceSet?.shopMoney?.amount || '0');
      totalRevenue += orderTotal;
      currency = order.totalPriceSet?.shopMoney?.currencyCode || 'USD';

      for (const lineItem of (order.lineItems?.nodes || [])) {
        const productTitle = lineItem.variant?.product?.title || lineItem.title || 'Unknown';
        const quantity = lineItem.quantity || 1;
        const price = parseFloat(lineItem.variant?.price || '0');
        const lineRevenue = price * quantity;

        if (!productSales[productTitle]) {
          productSales[productTitle] = { title: productTitle, quantity: 0, revenue: 0 };
        }
        productSales[productTitle].quantity += quantity;
        productSales[productTitle].revenue += lineRevenue;
      }
    }

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const averageOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

    return {
      totalOrders: orders.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      currency,
      periodStart: createdAtMin,
      periodEnd: createdAtMax,
      topProducts,
    };
  }

  async getCashTrackingSessions(date: string): Promise<any[]> {
    const startOfDay = `${date}T00:00:00Z`;
    const endOfDay = `${date}T23:59:59Z`;

    const query = `
      query GetCashTrackingSessions($first: Int!, $query: String, $after: String) {
        cashTrackingSessions(first: $first, query: $query, after: $after) {
          nodes {
            id
            name
            status
            openedAt
            closedAt
            register {
              id
              name
            }
            location {
              id
              name
            }
            openingFloat {
              shopMoney {
                amount
                currencyCode
              }
            }
            expectedClosingCash {
              shopMoney {
                amount
              }
            }
            reportedClosingCash {
              shopMoney {
                amount
              }
            }
            cashSalesCents: cashSales {
              shopMoney {
                amount
              }
            }
            cashRefundsCents: cashRefunds {
              shopMoney {
                amount
              }
            }
            cashAdjustments {
              shopMoney {
                amount
              }
            }
            totalSales {
              shopMoney {
                amount
              }
            }
            transactions {
              nodes {
                amount {
                  shopMoney {
                    amount
                  }
                }
                type
                note
                staffMember {
                  name
                }
                occurredAt
              }
            }
            tenderTypeSummaries {
              nodes {
                tenderType
                amount {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      const allNodes: any[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const variables: any = {
          first: 50,
          query: `opened_at:>=${startOfDay} opened_at:<=${endOfDay}`,
        };
        if (cursor) variables.after = cursor;

        const response = await this.makeGraphQLRequest(query, variables);
        const connection = response.data?.cashTrackingSessions;
        allNodes.push(...(connection?.nodes || []));
        hasNextPage = connection?.pageInfo?.hasNextPage ?? false;
        cursor = connection?.pageInfo?.endCursor ?? null;
        if (!cursor) break;
      }

      return allNodes;
    } catch (error: any) {
      if (error.message?.includes('cashTrackingSessions') || error.message?.includes('not supported') || error.message?.includes('unauthorized')) {
        console.warn('[ShopifyService] cashTrackingSessions API not available (requires POS Pro):', error.message);
        return [];
      }
      throw error;
    }
  }

  async getLocations(): Promise<ShopifyLocation[]> {
    const query = `
      query GetLocations($first: Int!, $after: String) {
        locations(first: $first, after: $after, includeInactive: false) {
          nodes {
            id
            name
            address {
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            phone
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const allLocations: ShopifyLocation[] = [];
    let cursor: string | null = null;

    try {
      do {
        const variables: Record<string, any> = { first: 50 };
        if (cursor) variables.after = cursor;

        const response = await this.makeGraphQLRequest(query, variables);
        const connection = response.data?.locations;
        allLocations.push(...(connection?.nodes || []));
        cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (cursor);
    } catch (error: any) {
      console.error('[ShopifyService] getLocations failed:', error.message);
      throw error;
    }

    return allLocations;
  }

  async registerWebhook(callbackUrl: string, topic: string = 'orders/create') {
    const graphqlQuery = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
            endpoint {
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      topic: topic.toUpperCase().replace('/', '_'),
      webhookSubscription: {
        callbackUrl,
        format: 'JSON',
      },
    };

    const response = await this.makeGraphQLRequest(graphqlQuery, variables);
    return response.data?.webhookSubscriptionCreate;
  }
}
