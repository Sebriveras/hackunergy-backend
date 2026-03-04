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
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const data = await response.json();
    console.log('Gemini response:', JSON.stringify(data));

    if (!response.ok) {
      throw new Error(`Gemini API error: ${JSON.stringify(data)}`);
    }

    const text = data.candidates[0].content.parts[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No se encontró JSON en la respuesta');

    const leads = JSON.parse(jsonMatch[0]);
    res.json({ status: 'SUCCESS', leads });

  } catch (error) {
    console.error('error:', error.message);
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});
