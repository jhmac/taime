import { useEffect } from "react";
import { useSearch } from "wouter";

export default function ShopifyCallbackSuccess() {
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const shop = params.get("shop");
    const error = params.get("error");
    const message = params.get("message");

    if (window.opener && !window.opener.closed) {
      if (error) {
        window.opener.postMessage(
          { type: "shopify-oauth-error", message: message || "Connection failed" },
          window.location.origin
        );
      } else {
        window.opener.postMessage(
          { type: "shopify-oauth-success", shop },
          window.location.origin
        );
      }
      window.close();
    } else {
      if (error) {
        window.location.href = `/admin?shopify=error&message=${encodeURIComponent(message || "Connection failed")}&section=pos-connection`;
      } else {
        window.location.href = `/admin?shopify=connected&shop=${encodeURIComponent(shop || "")}&section=pos-connection`;
      }
    }
  }, [search]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center space-y-4 p-8">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-gray-600 text-sm">Shopify connected! Closing window...</p>
      </div>
    </div>
  );
}
