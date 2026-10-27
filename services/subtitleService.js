const fs = require('fs');
const path = require('path');

/**
 * Format milliseconds thành timestamp SRT: HH:MM:SS,mmm
 */
function formatSrtTime(ms) {
  const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
  const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
  const mmm = Math.floor(ms % 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${mmm}`;
}

/**
 * Format milliseconds thành timestamp ASS: H:MM:SS.cc
 */
function formatAssTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
  const cs = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
  return `${h}:${m}:${s}.${cs}`;
}

/**
 * Tạo file SRT từ danh sách cues
 * @param {Array} cues - [{ startMs, endMs, text }]
 * @param {string} outputPath
 */
function generateSRT(cues, outputPath) {
  const srtContent = cues.map((cue, index) => {
    return `${index + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}\n`;
  }).join('\n');
  
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, srtContent, 'utf-8');
  console.log(`[Subtitle] Đã tạo file SRT: ${outputPath}`);
  return outputPath;
}

/**
 * Tạo file ASS với style TikTok đẹp mắt
 * Kế thừa từ KrillinAI: Custom ASS style preset cho video ngắn
 * @param {Array} cues - [{ startMs, endMs, text }]
 * @param {object} style - Custom style options
 * @param {string} outputPath
 */
function generateASS(cues, style = {}, outputPath) {
  const fontName = style.fontName || 'Arial';
  const fontSize = style.fontSize || 20;
  const primaryColor = style.primaryColor || '&H00FFFFFF'; // White
  const outlineColor = style.outlineColor || '&H00000000'; // Black
  const backColor = style.backColor || '&H80000000'; // Semi-transparent black
  const outline = style.outline || 2;
  const shadow = style.shadow || 1;
  const marginV = style.marginV || 30;
  const alignment = style.alignment || 2; // Bottom center
  
  const header = `[Script Info]
Title: DouyinTikTok Studio Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},&H000000FF,${outlineColor},${backColor},-1,0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  
  const events = cues.map(cue => {
    return `Dialogue: 0,${formatAssTime(cue.startMs)},${formatAssTime(cue.endMs)},Default,,0,0,0,,${cue.text}`;
  }).join('\n');
  
  const assContent = header + events + '\n';
  
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, assContent, 'utf-8');
  console.log(`[Subtitle] Đã tạo file ASS: ${outputPath}`);
  return outputPath;
}

/**
 * Tự động chia text thành các cues dựa trên thời lượng video
 * Dùng khi không có timestamp cụ thể
 * @param {string} text - Full translated text
 * @param {number} durationMs - Tổng thời lượng video (ms)
 * @param {number} maxCharsPerCue - Số ký tự tối đa mỗi dòng phụ đề
 */
function autoGenerateCues(text, durationMs, maxCharsPerCue = 40) {
  // Tách thành các câu dựa trên dấu câu
  const sentences = text.split(/(?<=[.!?。！？,，;；\n])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  // Nếu không tách được, chia theo maxCharsPerCue
  let segments = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxCharsPerCue) {
      segments.push(sentence);
    } else {
      // Chia câu dài thành các đoạn ngắn
      for (let i = 0; i < sentence.length; i += maxCharsPerCue) {
        segments.push(sentence.substring(i, i + maxCharsPerCue));
      }
    }
  }
  
  if (segments.length === 0) segments = [text];
  
  // Phân bổ thời gian đều cho từng segment
  const timePerSegment = durationMs / segments.length;
  
  return segments.map((segment, index) => ({
    startMs: Math.round(index * timePerSegment),
    endMs: Math.round((index + 1) * timePerSegment),
    text: segment
  }));
}

module.exports = {
  formatSrtTime,
  formatAssTime,
  generateSRT,
  generateASS,
  autoGenerateCues
};
