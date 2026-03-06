const functions = require('@google-cloud/functions-framework');

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Respuesta no-JSON (${res.status}): ${text.substring(0, 200)}`);
  }
}

async function getCompanyFromHubSpot(companyId, token) {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name,industry,industrygroup,city,country,state,annualrevenue,numberofemployees,hs_keywords,linkedin_company_page,website,description,scoped_roles,seniority_level,target_departments,business_context,decision_maker_only`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`HubSpot error: ${JSON.stringify(data)}`);
  return data.properties;
}

// ── Apollo ──────────────────────────────────────────────────────────────────

async function getLastName(id, apiKey) {
  const res = await fetch(`https://api.apollo.io/api/v1/people/${id}`, {
    headers: { 'X-Api-Key': apiKey }
  });
  const data = await safeJson(res);
  if (!res.ok) return '';
  return data.person?.last_name || '';
}

async function getEmail(firstName, lastName, orgName, apiKey) {
  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      organization_name: orgName,
      reveal_personal_emails: true
    })
  });
  const data = await safeJson(res);
  if (!res.ok) return '';
  const email = data.person?.email || '';
  return email.includes('not_unlocked') ? '' : email;
}

async function getLeadsFromApollo(props) {
  const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
  const domain = props.website
    ? props.website.replace(/https?:\/\//, '').split('/')[0]
    : undefined;

  const body = { q_organization_name: props.name, per_page: 10, page: 1 };
  if (domain) body.organization_domains = [domain];

  const searchRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': APOLLO_API_KEY
    },
    body: JSON.stringify(body)
  });
  const searchData = await safeJson(searchRes);
  if (!searchRes.ok) throw new Error(`Apollo search error: ${JSON.stringify(searchData)}`);

  const people = searchData.people || [];
  if (people.length === 0) return [];

  const lastNames = await Promise.all(
    people.map(p => p.id ? getLastName(p.id, APOLLO_API_KEY) : Promise.resolve(''))
  );

  const emails = await Promise.all(
    people.map((p, i) =>
      lastNames[i]
        ? getEmail(p.first_name, lastNames[i], p.organization?.name || props.name, APOLLO_API_KEY)
        : Promise.resolve('')
    )
  );

  return people.map((p, i) => ({
    name: p.first_name || '',
    lastName: lastNames[i] || '',
    company: p.organization?.name || props.name,
    rol: p.title || '',
    cellphone: '',
    email: emails[i] || ''
  }));
}

// ── Lusha ───────────────────────────────────────────────────────────────────

async function getLeadsFromLusha(props) {
  const LUSHA_API_KEY = process.env.LUSHA_API_KEY;
  const domain = props.website
    ? props.website.replace(/https?:\/\//, '').split('/')[0]
    : undefined;

  const requestBody = { limit: 10, page: 1 };
  if (domain) {
    requestBody.company = { website: domain };
  } else {
    requestBody.company = { name: props.name };
  }
  if (props.seniority_level) {
    requestBody.seniority = props.seniority_level.split(',').map(s => s.trim().toLowerCase());
  }
  if (props.target_departments) {
    requestBody.departments = props.target_departments.split(',').map(d => d.trim().toLowerCase());
  }

  const res = await fetch('https://api.lusha.com/prospecting/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api_key': LUSHA_API_KEY },
    body: JSON.stringify(requestBody)
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`Lusha error: ${JSON.stringify(data)}`);

  return (data.data?.contacts || data.contacts || data.data || []).map(p => ({
    name: p.firstName || p.first_name || '',
    lastName: p.lastName || p.last_name || '',
    company: p.company?.name || props.name,
    rol: p.jobTitle || p.job_title || p.title || '',
    cellphone: p.mobilePhones?.[0]?.number || p.phones?.[0]?.number || '',
    email: p.emails?.[0]?.email || p.email || ''
  }));
}

// ── Routing ──────────────────────────────────────────────────────────────────

const sourceHandlers = {
  'Apollo': getLeadsFromApollo,
  'Lusha': getLeadsFromLusha,
};

functions.http('getLeads', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const { companyId, source } = req.body;
  const TOKEN = process.env.PRIVATE_APP_ACCESS_TOKEN;

  try {
    const props = await getCompanyFromHubSpot(companyId, TOKEN);
    const handler = sourceHandlers[source];
    if (!handler) throw new Error(`Fuente no soportada: ${source}`);
    const leads = await handler(props);
    res.json({ status: 'SUCCESS', leads });
  } catch (error) {
    console.error('error:', error.message);
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});
