// netlify/functions/ingest.js
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN } = process.env;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-ingest-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  try {
    // 1) Preflight CORS
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    // 2) Apenas POST
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // 3) Auth simples
    const token = event.headers['x-ingest-token'] || event.headers['X-Ingest-Token'];
    if (!token || token !== INGEST_TOKEN) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    // 4) Parse body
    const { date, summary = [], gaps = [] } = JSON.parse(event.body || '{}');
    if (!date) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing "date" (YYYY-MM-DD)' }),
      };
    }

    // 5) Helpers REST
    const base = `${SUPABASE_URL}/rest/v1`;
    const authHeaders = {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=minimal',
    };

    const del = (table) =>
      fetch(`${base}/${table}?date=eq.${encodeURIComponent(date)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });

    const bulkInsert = (table, rows) =>
      rows.length
        ? fetch(`${base}/${table}`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(rows),
          })
        : { ok: true };

    // 6) Apaga do dia alvo (gaps -> summary, por FK)
    const delGapsRes = await del('online_picking_gaps');
    if (!delGapsRes.ok) {
      const t = await delGapsRes.text();
      throw new Error(`Delete gaps failed: ${t}`);
    }

    const delSummaryRes = await del('online_picking_summary');
    if (!delSummaryRes.ok) {
      const t = await delSummaryRes.text();
      throw new Error(`Delete summary failed: ${t}`);
    }

    // 7) Insere summary e gaps
    const insSummaryRes = await bulkInsert('online_picking_summary', summary);
    if (!insSummaryRes.ok) {
      const t = await insSummaryRes.text();
      throw new Error(`Insert summary failed: ${t}`);
    }

    const insGapsRes = await bulkInsert('online_picking_gaps', gaps);
    if (!insGapsRes.ok) {
      const t = await insGapsRes.text();
      throw new Error(`Insert gaps failed: ${t}`);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, inserted: { summary: summary.length, gaps: gaps.length } }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
