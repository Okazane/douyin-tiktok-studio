const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');

// Danh sách giọng đọc Việt Nam có sẵn
const VOICES = {
  'hoaimy': {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My',
    gender: 'Nữ',
    description: 'Giọng nữ miền Bắc, tự nhiên, truyền cảm'
  },
  'namminh': {
    id: 'vi-VN-NamMinhNeural', 
    name: 'Nam Minh',
    gender: 'Nam',
    description: 'Giọng nam rõ ràng, chuyên nghiệp'
  }
};

/**
 * Lấy danh sách giọng đọc có sẵn
 */
function listVoices() {
  return Object.entries(VOICES).map(([key, voice]) => ({
    key,
    ...voice
  }));
}

/**
 * Tạo file audio voiceover
 * Kế thừa từ KrillinAI: Edge TTS integration với tùy chỉnh rate/pitch
 * @param {string} text - Nội dung cần đọc
 * @param {string} voiceKey - Key giọng đọc ('hoaimy' hoặc 'namminh')
 * @param {object} options - { rate: '+10%', pitch: '+0Hz', volume: '+0%' }
 * @param {string} outputPath - Đường dẫn file output MP3
 */
async function generateVoiceover(text, voiceKey = 'hoaimy', options = {}, outputPath) {
  const voice = VOICES[voiceKey];
  if (!voice) {
    throw new Error(`Giọng đọc "${voiceKey}" không tồn tại. Chọn: ${Object.keys(VOICES).join(', ')}`);
  }
  
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const rate = options.rate || '+0%';
  const pitch = options.pitch || '+0Hz';
  const volume = options.volume || '+0%';
  
  console.log(`[TTS] Đang tạo voiceover với giọng ${voice.name} (${voice.gender})...`);
  console.log(`[TTS] Tốc độ: ${rate}, Cao độ: ${pitch}, Âm lượng: ${volume}`);
  
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice.id, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  
  // Tạo SSML với prosody settings
  const ssml = `
  <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="vi-VN">
    <voice name="${voice.id}">
      <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
        ${escapeXml(text)}
      </prosody>
    </voice>
  </speak>`.trim();
  
  const result = await tts.toFile(outputPath, ssml);
  console.log(`[TTS] Đã tạo file: ${outputPath}`);
  
  return {
    filePath: outputPath,
    voice: voice.name,
    gender: voice.gender,
    duration: result.duration || null
  };
}

/**
 * Tạo audio preview ngắn để nghe thử
 */
async function generatePreview(text, voiceKey = 'hoaimy', options = {}, outputPath) {
  // Cắt text ngắn nếu quá dài (chỉ preview 100 ký tự đầu)
  const previewText = text.length > 100 ? text.substring(0, 100) + '...' : text;
  return generateVoiceover(previewText, voiceKey, options, outputPath);
}

/**
 * Escape ký tự đặc biệt cho XML/SSML
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  VOICES,
  listVoices,
  generateVoiceover,
  generatePreview
};
