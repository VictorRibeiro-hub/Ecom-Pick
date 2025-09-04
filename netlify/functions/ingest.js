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

    // 3) Auth simples por header
    const token = event.headers['x-ingest-token'] || event.headers['X-Ingest-Token'];
    if (!token || token !== INGEST_TOKEN) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    // 4) Body esperado: { date, summary:[], gaps:[] }
    const { date, summary = [], gaps = [] } = JSON.parse(event.body || '{}');
    if (!date) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing "date" (YYYY-MM-DD)' }),
      };
    }

    // 5) Helpers REST p/ Supabase
    const base = `${SUPABASE_URL}/rest/v1`;
    const authHeaders = {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=minimal',
    };

    const delByDate = (table) =>
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

    // 6) Apaga dados do dia (ordem: gaps -> summary por FK)
    const delGaps = await delByDate('online_picking_gaps');
    if (!delGaps.ok) throw new Error(`Delete gaps failed: ${await delGaps.text()}`);

    const delSummary = await delByDate('online_picking_summary');
    if (!delSummary.ok) throw new Error(`Delete summary failed: ${await delSummary.text()}`);

    // 7) Insere novos registos
    const insSummary = await bulkInsert('online_picking_summary', summary);
    if (!insSummary.ok) throw new Error(`Insert summary failed: ${await insSummary.text()}`);

    const insGaps = await bulkInsert('online_picking_gaps', gaps);
    if (!insGaps.ok) throw new Error(`Insert gaps failed: ${await insGaps.text()}`);

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
