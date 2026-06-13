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

  const instrucao = `Você é um corretor oficial do ENEM. Avalie a redação nas 5 competências, cada uma de 0 a 200 (use apenas múltiplos de 40: 0, 40, 80, 120, 160 ou 200).

Retorne SOMENTE um JSON válido, sem nenhum texto antes ou depois, sem markdown, sem blocos de código:
{"competencias":[
  {"nome":"Competência I","desc":"Domínio da norma culta","nota":NUMERO,"nivel":"NIVEL","feedback":"FEEDBACK"},
  {"nome":"Competência II","desc":"Compreensão do tema","nota":NUMERO,"nivel":"NIVEL","feedback":"FEEDBACK"},
  {"nome":"Competência III","desc":"Organização e argumentação","nota":NUMERO,"nivel":"NIVEL","feedback":"FEEDBACK"},
  {"nome":"Competência IV","desc":"Coesão e coerência","nota":NUMERO,"nivel":"NIVEL","feedback":"FEEDBACK"},
  {"nome":"Competência V","desc":"Proposta de intervenção","nota":NUMERO,"nivel":"NIVEL","feedback":"FEEDBACK"}
]}

Regras de nível: alta = 160 ou 200 | media = 80 ou 120 | baixa = 0 ou 40
Feedback: 2 a 3 frases específicas sobre o que foi observado na redação.
Tema informado: ${theme || 'não informado'}
${photoNote ? `Observação sobre a foto: ${photoNote}` : ''}`;

  let resultText;

  try {
    if (mode === 'photo' && photoBase64 && photoMime) {
      // ── MODO FOTO: usa Google Gemini (suporta visão) ──
      const geminiKey = process.env.GEMINI_API_KEY;
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inline_data: {
                    mime_type: photoMime,
                    data: photoBase64
                  }
                },
                {
                  text: `${instrucao}\n\nA redação está na imagem acima. Leia o texto manuscrito ou digitado e avalie conforme as instruções.`
                }
              ]
            }],
            generationConfig: { temperature: 0.3 }
          })
        }
      );

      const geminiData = await geminiRes.json();

      if (geminiData.error) {
        return { statusCode: 500, body: JSON.stringify({ error: geminiData.error.message }) };
      }

      resultText = geminiData.candidates[0].content.parts[0].text;

    } else {
      // ── MODO TEXTO: usa Groq (Llama) ──
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
          temperature: 0.3
        })
      });

      const groqData = await groqRes.json();

      if (groqData.error) {
        return { statusCode: 500, body: JSON.stringify({ error: groqData.error.message }) };
      }

      resultText = groqData.choices[0].message.content;
    }

    // Faz o parse do JSON retornado pela IA
    const clean = resultText.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    const parsed = JSON.parse(clean.substring(start, end + 1));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
