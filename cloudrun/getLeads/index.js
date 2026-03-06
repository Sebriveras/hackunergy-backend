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

async function revealPerson(id, apiKey) {
  const res = await fetch(
    `https://api.apollo.io/api/v1/people/${id}?reveal_personal_emails=true&reveal_phone_number=true`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey
      }
    }
  );
  const data = await safeJson(res);
  if (!res.ok) return {};
  const p = data.person || {};
  return {
    lastName: p.last_name || '',
    email: p.email || '',
    cellphone: p.phone_numbers?.[0]?.sanitized_number || ''
  };
}

async function getLeadsFromApollo(props) {
  const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
  const domain = props.website
    ? props.website.replace(/https?:\/\//, '').split('/')[0]
    : undefined;

  const body = { q_organization_name: props.name, per_page: 10, page: 1 };
  if (domain) body.organization_domains = [domain];

  const res = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': APOLLO_API_KEY
    },
    body: JSON.stringify(body)
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`Apollo search error: ${JSON.stringify(data)}`);

  const people = data.people || [];
  if (people.length === 0) return [];

  const revealed = await Promise.all(
    people.map(p => p.id ? revealPerson(p.id, APOLLO_API_KEY) : Promise.resolve({}))
  );

  return people.map((p, i) => ({
    name: p.first_name || '',
    lastName: revealed[i].lastName || p.last_name || '',
    company: p.organization?.name || props.name,
    rol: p.title || '',
    cellphone: revealed[i].cellphone || p.phone_numbers?.[0]?.sanitized_number || '',
    email: revealed[i].email || p.email || ''
  }));
}

async function getLeadsFromClaude(props, source) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const companyName = props.name || 'desconocido';

  const prompt = `Genera una lista de 10 contactos potenciales dentro de la empresa "${companyName}" simulando una búsqueda en la base de datos ${source}.

Perfil de la empresa:
- Sector: ${props.industry || 'desconocido'}
- Ubicación: ${props.city || ''}, ${props.state || ''}, ${props.country || ''}
- Empleados: ${props.numberofemployees || 'desconocido'}
- Descripción: ${props.description || ''}

Criterios:
- Roles objetivo: ${props.scoped_roles || 'cualquier rol relevante'}
- Nivel de seniority: ${props.seniority_level || 'cualquier nivel'}
- Departamentos: ${props.target_departments || 'cualquier departamento'}
- Contexto: ${props.business_context || 'ninguno'}

Devuelve ÚNICAMENTE un array JSON válido, sin texto adicional:
[{ "name": "Nombre", "lastName": "Apellido", "company": "${companyName}", "rol": "Cargo", "cellphone": 3001234567, "email": "email@empresa.com" }]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await safeJson(response);
  if (!response.ok) throw new Error(`Claude error: ${JSON.stringify(data)}`);

  const text = data.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No se encontró JSON en la respuesta de Claude');
  return JSON.parse(jsonMatch[0]);
}

const sourceHandlers = {
  'Apollo': getLeadsFromApollo,
  'Clay': (props) => getLeadsFromClaude(props, 'Clay'),
  'Instantly': (props) => getLeadsFromClaude(props, 'Instantly'),
  'Snovio': (props) => getLeadsFromClaude(props, 'Snovio'),
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
    const handler = sourceHandlers[source] || ((p) => getLeadsFromClaude(p, source));
    const leads = await handler(props);
    res.json({ status: 'SUCCESS', leads });
  } catch (error) {
    console.error('error:', error.message);
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});
