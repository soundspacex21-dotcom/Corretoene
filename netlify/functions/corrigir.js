exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { theme, essay, mode, photoBase64, photoMime, photoNote } = body;

  const descs = [
    'Domínio da norma culta',
    'Compreensão do tema',
    'Organização e argumentação',
    'Coesão e coerência',
    'Proposta de intervenção'
  ];

  const instrucao = `Você é um corretor oficial do ENEM. Avalie a redação nas 5 competências do ENEM.

REGRAS OBRIGATÓRIAS:
- Cada competência recebe uma nota DIFERENTE e INDEPENDENTE
- Use APENAS estes valores: 0, 40, 80, 120, 160 ou 200
- NÃO repita a mesma nota para todas as competências
- Analise cada competência separadamente com rigor

Retorne SOMENTE este JSON, sem texto antes ou depois, sem markdown:
{
  "c1": {"nota": NUMERO, "nivel": "NIVEL", "feedback": "FEEDBACK ESPECIFICO"},
  "c2": {"nota": NUMERO, "nivel": "NIVEL", "feedback": "FEEDBACK ESPECIFICO"},
  "c3": {"nota": NUMERO, "nivel": "NIVEL", "feedback": "FEEDBACK ESPECIFICO"},
  "c4": {"nota": NUMERO, "nivel": "NIVEL", "feedback": "FEEDBACK ESPECIFICO"},
  "c5": {"nota": NUMERO, "nivel": "NIVEL", "feedback": "FEEDBACK ESPECIFICO"}
}

nivel: "alta" se nota >= 160 | "media" se nota 80 ou 120 | "baixa" se nota <= 40
Feedback: 2 frases específicas sobre o que foi observado nesta competência.
Tema: ${theme || 'não informado'}
${photoNote ? `Observação: ${photoNote}` : ''}`;

  // Modelos Gemini para tentar em ordem
  const geminiModels = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ];

  let resultText;

  try {
    if (mode === 'photo' && photoBase64 && photoMime) {
      const geminiKey = process.env.GEMINI_API_KEY;
      let geminiData = null;

      // Tenta cada modelo até um funcionar
      for (const model of geminiModels) {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: photoMime, data: photoBase64 } },
                  { text: `${instrucao}\n\nA redação está na imagem acima. Leia e avalie.` }
                ]
              }],
              generationConfig: { temperature: 0.4 }
            })
          }
        );

        geminiData = await geminiRes.json();

        // Se não tiver erro, usa esse modelo
        if (!geminiData.error) break;
      }

      if (!geminiData || geminiData.error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Nenhum modelo Gemini disponível: ' + geminiData?.error?.message }) };
      }

      resultText = geminiData.candidates[0].content.parts[0].text;

    } else {
      const groqKey = process.env.GROQ_API_KEY;
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{
            role: 'user',
            content: `${instrucao}\n\nRedação:\n${essay || 'não fornecida'}`
          }],
          temperature: 0.4
        })
      });

      const groqData = await groqRes.json();
      if (groqData.error) {
        return { statusCode: 500, body: JSON.stringify({ error: groqData.error.message }) };
      }
      resultText = groqData.choices[0].message.content;
    }

    const clean = resultText.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    const raw = JSON.parse(clean.substring(start, end + 1));

    const competencias = ['c1','c2','c3','c4','c5'].map((key, i) => ({
      nome: `Competência ${['I','II','III','IV','V'][i]}`,
      desc: descs[i],
      nota: raw[key]?.nota ?? 0,
      nivel: raw[key]?.nivel ?? 'baixa',
      feedback: raw[key]?.feedback ?? ''
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competencias })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
