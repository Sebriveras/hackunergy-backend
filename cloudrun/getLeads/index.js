const functions = require('@google-cloud/functions-framework');

functions.http('getLeads', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const { companyId } = req.body;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const TOKEN = process.env.PRIVATE_APP_ACCESS_TOKEN;

  try {
    // Fetch company properties from HubSpot API
    const companyRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name,industry,industrygroup,city,country,state,annualrevenue,numberofemployees,hs_keywords,linkedin_company_page,website,description,scoped_roles,seniority_level,target_departments,business_context,decision_maker_only`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const company = await companyRes.json();
    if (!companyRes.ok) {
      throw new Error(`HubSpot API error: ${JSON.stringify(company)}`);
    }

    const props = company.properties;
    const companyName = props?.name || 'desconocido';

    const prompt = `Genera una lista de 10 contactos potenciales dentro de la empresa "${companyName}".

Perfil de la empresa:
- Sector: ${props?.industry || 'desconocido'}
- Grupo de sector: ${props?.industrygroup || ''}
- Ubicación: ${props?.city || ''}, ${props?.state || ''}, ${props?.country || ''}
- Ingresos anuales: ${props?.annualrevenue || 'desconocido'}
- Empleados: ${props?.numberofemployees || 'desconocido'}
- Palabras clave: ${props?.hs_keywords || ''}
- LinkedIn: ${props?.linkedin_company_page || ''}
- Descripción: ${props?.description || ''}

Criterios de búsqueda:
- Roles objetivo: ${props?.scoped_roles || 'cualquier rol relevante'}
- Nivel de seniority: ${props?.seniority_level || 'cualquier nivel'}
- Departamentos: ${props?.target_departments || 'cualquier departamento'}
- Solo tomadores de decisión: ${props?.decision_maker_only ? 'sí' : 'no'}
- Contexto de negocio: ${props?.business_context || 'ninguno'}

Devuelve ÚNICAMENTE un array JSON válido con este formato exacto, sin texto adicional:
[
  {
    "name": "Nombre",
    "lastName": "Apellido",
    "company": "${companyName}",
    "rol": "Cargo",
    "cellphone": 3001234567,
    "email": "email@empresa.com"
  }
]`;

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

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Claude API error: ${JSON.stringify(data)}`);
    }

    const text = data.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No se encontró JSON en la respuesta');
    const leads = JSON.parse(jsonMatch[0]);
    res.json({ status: 'SUCCESS', leads });

  } catch (error) {
    console.error('error:', error.message);
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});
