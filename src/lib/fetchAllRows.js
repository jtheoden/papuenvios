/**
 * Reads every row of a query in pages: PostgREST cuts a response at max_rows (~1000) without any error,
 * so an unpaged select silently under-reports. The query MUST have a stable `.order()`.
 *
 * @param {(from: number, to: number) => PromiseLike<{data: Array|null, error: object|null}>} fetchPage
 *   builds the query for one page, e.g. `(from, to) => supabase.from('t').select('*').order('id').range(from, to)`
 * @returns {Promise<{data: Array|null, error: object|null}>} same shape as a single supabase response
 */
export const PAGE_SIZE = 1000;

export const fetchAllRows = async (fetchPage) => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
};
