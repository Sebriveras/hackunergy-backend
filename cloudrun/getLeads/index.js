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
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: `Genera una lista de 10 contactos potenciales dentro de la empresa "${companyName}".

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
]`
          }
        ],
        max_tokens: 2048,
        temperature: 0.7
      })
    });

    const data = await response.json();
    console.log('OpenAI response:', JSON.stringify(data));

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${JSON.stringify(data)}`);
    }

    const leads = JSON.parse(data.choices[0].message.content);
    res.json({ status: 'SUCCESS', leads });

  } catch (error) {
    console.error('error:', error.message);
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});
