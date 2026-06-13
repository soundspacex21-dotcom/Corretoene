exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

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

  // Monta o conteúdo da mensagem dependendo do modo
  let messageContent;

  if (mode === 'photo' && photoBase64 && photoMime) {
    // Modo foto: envia imagem + instrução
    messageContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: photoMime,
          data: photoBase64
        }
      },
      {
        type: 'text',
        text: `${instrucao}\n\nA redação está na imagem acima. Leia o texto manuscrito ou digitado e avalie conforme as instruções.`
      }
    ];
  } else {
    // Modo texto
    messageContent = [
      {
        type: 'text',
        text: `${instrucao}\n\nRedação:\n${essay || 'não fornecida'}`
      }
    ];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: messageContent }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }

    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
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
