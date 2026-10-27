const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
let model = null;

/**
 * Khởi tạo Gemini AI client
 * Cần GEMINI_API_KEY trong biến môi trường hoặc config
 */
function initialize(apiKey) {
  if (!apiKey) {
    throw new Error('Cần GEMINI_API_KEY để sử dụng dịch thuật AI. Lấy miễn phí tại https://aistudio.google.com/');
  }
  genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  console.log('[TranslateService] Đã kết nối Google Gemini Flash');
}

/**
 * Dịch một đoạn text Trung → Việt với ngữ cảnh TikTok
 * Kế thừa từ pyVideoTrans & KrillinAI: Context-aware LLM translation
 */
async function translateText(text, context = 'video_title') {
  if (!model) {
    throw new Error('TranslateService chưa được khởi tạo. Gọi initialize(apiKey) trước.');
  }
  
  let systemPrompt;
  
  if (context === 'video_title') {
    systemPrompt = `Bạn là chuyên gia dịch thuật Trung-Việt cho video TikTok.
Hãy dịch đoạn text tiếng Trung sau sang tiếng Việt sao cho:
- Tự nhiên như người Việt nói hàng ngày
- Phù hợp phong cách video ngắn TikTok (ngắn gọn, bắt trend, gần gũi)
- Giữ nguyên ý nghĩa và cảm xúc gốc
- Không dịch máy móc từng từ
- Chỉ trả về bản dịch tiếng Việt, KHÔNG giải thích gì thêm`;
  } else if (context === 'script') {
    systemPrompt = `Bạn là chuyên gia dịch thuật Trung-Việt cho kịch bản video lồng tiếng.
Hãy dịch đoạn kịch bản tiếng Trung sau sang tiếng Việt sao cho:
- Tự nhiên, trôi chảy như người Việt đang nói chuyện
- Giữ đúng số lượng câu (mỗi dòng input → mỗi dòng output)
- Mỗi câu dịch nên có độ dài tương đương câu gốc (để khớp khi lồng tiếng)
- Dùng từ ngữ đời thường, dễ hiểu, phù hợp video TikTok
- Giữ nguyên cảm xúc, giọng điệu (hài hước, nghiêm túc, bất ngờ...)
- Chỉ trả về bản dịch, mỗi câu một dòng, KHÔNG đánh số, KHÔNG giải thích`;
  } else if (context === 'drama') {
    systemPrompt = `Bạn là chuyên gia dịch thuật và biên kịch phim Trung-Việt, chuyên dịch kịch bản phim ngắn Douyin/TikTok.
Hãy dịch kịch bản phim ngắn tiếng Trung sau sang tiếng Việt sao cho:
- Giữ nguyên tên nhân vật gốc (viết phiên âm Hán-Việt hoặc giữ nguyên)
- Lời thoại tự nhiên, diễn cảm, phù hợp hoàn cảnh kịch (vui, buồn, giận dữ, lãng mạn...)
- Giữ đúng cấu trúc: mỗi dòng input → mỗi dòng output
- Dịch cả chỉ dẫn cảnh quay nếu có (VD: 第一幕 → Cảnh 1)
- Câu thoại trong ngoặc kép giữ nguyên ngoặc kép
- Giọng điệu phải phù hợp thể loại phim (ngôn tình, hài, kinh dị, cổ trang...)
- Không dịch máy móc, phải truyền tải được cảm xúc nhân vật
- Chỉ trả về bản dịch, mỗi câu một dòng, KHÔNG đánh số, KHÔNG giải thích`;
  } else {
    systemPrompt = `Dịch đoạn text tiếng Trung sau sang tiếng Việt tự nhiên. Chỉ trả về bản dịch.`;
  }
  
  try {
    const result = await model.generateContent([
      { text: systemPrompt },
      { text: text }
    ]);
    
    const response = result.response;
    const translatedText = response.text().trim();
    
    return translatedText;
  } catch (error) {
    throw new Error(`Lỗi dịch thuật Gemini: ${error.message}`);
  }
}

/**
 * Dịch hàng loạt câu thoại, giữ nguyên cấu trúc
 * Kế thừa từ KrillinAI: Batch translation với line preservation
 */
async function translateScript(lines) {
  if (!lines || lines.length === 0) return [];
  
  // Ghép các câu thành block text, ngăn cách bằng newline
  const inputText = lines.map(line => line.text || line).join('\n');
  
  const translated = await translateText(inputText, 'script');
  
  // Tách lại thành từng câu
  const translatedLines = translated.split('\n').filter(l => l.trim());
  
  // Map lại với timestamp nếu có
  return lines.map((line, index) => {
    const result = {
      original: typeof line === 'string' ? line : line.text,
      translated: translatedLines[index] || '',
    };
    if (line.startMs !== undefined) result.startMs = line.startMs;
    if (line.endMs !== undefined) result.endMs = line.endMs;
    return result;
  });
}

async function translateDrama(text, genre = 'general') {
  if (!model) {
    throw new Error('TranslateService chưa được khởi tạo. Gọi initialize(apiKey) trước.');
  }
  
  const genreHints = {
    'romance': 'Đây là phim ngôn tình/tình cảm. Dịch lời thoại lãng mạn, ngọt ngào, tình cảm.',
    'comedy': 'Đây là phim hài. Dịch sao cho hài hước, dí dỏm, vui nhộn phù hợp khán giả Việt.',
    'drama': 'Đây là phim chính kịch/drama. Dịch sao cho kịch tính, đầy cảm xúc, sâu sắc.',
    'action': 'Đây là phim hành động. Dịch sao cho mạnh mẽ, dứt khoát, căng thẳng.',
    'horror': 'Đây là phim kinh dị/bí ẩn. Dịch sao cho rùng rợn, hồi hộp, ly kỳ.',
    'historical': 'Đây là phim cổ trang. Dịch sao cho trang trọng, cổ kính nhưng vẫn dễ hiểu.',
    'general': 'Dịch tự nhiên, truyền tải đúng cảm xúc nhân vật.'
  };
  
  const genreHint = genreHints[genre] || genreHints['general'];
  
  const systemPrompt = `Bạn là chuyên gia dịch thuật và biên kịch phim Trung-Việt.
${genreHint}

Quy tắc dịch kịch bản phim ngắn:
- Giữ nguyên tên nhân vật (dùng phiên âm Hán-Việt hoặc giữ nguyên)
- Lời thoại phải tự nhiên, diễn cảm, phù hợp tính cách nhân vật
- Giữ đúng cấu trúc dòng: mỗi dòng input → mỗi dòng output
- Dịch cả chỉ dẫn cảnh (第一幕 → Cảnh 1, 旁白 → Lời dẫn)
- Câu thoại trong dấu ngoặc kép giữ nguyên ngoặc kép
- Truyền tải được cảm xúc, ngữ điệu của nhân vật
- Chỉ trả về bản dịch, KHÔNG giải thích, KHÔNG đánh số thêm`;

  try {
    const result = await model.generateContent([
      { text: systemPrompt },
      { text: text }
    ]);
    
    return result.response.text().trim();
  } catch (error) {
    throw new Error(`Lỗi dịch kịch bản phim: ${error.message}`);
  }
}

module.exports = {
  initialize,
  translateText,
  translateScript,
  translateDrama
};
