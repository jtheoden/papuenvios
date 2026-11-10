/**
 * Loads the admin catalog view (all products, testimonials and combos including
 * inactive ones) in parallel. Combos receive the products *promise* so their
 * stock check waits for the products without delaying the combos query itself.
 * Failures are isolated: each refresh already handles its own errors.
 */
export const loadAdminCatalog = async ({ refreshProducts, refreshTestimonials, refreshCombos }) => {
  const productsPromise = Promise.resolve(refreshProducts(true));
  await Promise.allSettled([
    productsPromise,
    refreshTestimonials(true),
    refreshCombos(true, productsPromise)
  ]);
};
