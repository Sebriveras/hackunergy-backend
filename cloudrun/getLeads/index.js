const functions = require('@google-cloud/functions-framework');

functions.http('getLeads', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const { companyName, context } = req.body;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  const prompt = `Genera una lista de 10 contactos potenciales dentro de la empresa "${companyName}".

Criterios de búsqueda:
- Roles objetivo: ${context?.ScopedRoles || 'cualquier rol relevante'}
- Nivel de seniority: ${context?.seniority || 'cualquier nivel'}
- Departamentos: ${context?.departments || 'cualquier departamento'}
- Solo tomadores de decisión: ${context?.decisionMaker ? 'sí' : 'no'}
- Palabras clave: ${context?.keywords || 'ninguna'}
- Contexto de negocio: ${context?.BussinessContext || 'ninguno'}

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

  try {
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

    const leads = JSON.parse(data.content[0].text);
    res.json({ status: 'SUCCESS', leads });

  } catch (error) {
    console.error('error:', error.message);
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});
