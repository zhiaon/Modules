/*
 * AdGuard Safari 扩展收据响应解锁
 * Surge-compatible rewrite; preserves unrelated response fields.
 */
(function () {
  var body = $response && $response.body;
  if (!body) {
    $done({});
    return;
  }

  var payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    $done({});
    return;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    $done({});
    return;
  }

  var products = Array.isArray(payload.products) ? payload.products.slice() : [];
  var existingProduct = products.length > 0 ? products[0] : null;
  var product = {};

  if (existingProduct && typeof existingProduct === "object" && !Array.isArray(existingProduct)) {
    for (var key in existingProduct) {
      if (Object.prototype.hasOwnProperty.call(existingProduct, key)) {
        product[key] = existingProduct[key];
      }
    }
  }

  product.premium_status = "ACTIVE";
  product.product_id = "com.adguard.lifetimePurchase";
  products[0] = product;
  payload.products = products;

  $done({ body: JSON.stringify(payload) });
})();
