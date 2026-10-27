const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const fs = require('fs');
const path = require('path');

// Cấu hình ffmpeg-static (không cần cài FFmpeg global)
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

console.log(`[Render] FFmpeg path: ${ffmpegStatic}`);

/**
 * Lấy thông tin media file (duration, codec, etc.)
 */
function getMediaInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(new Error(`Lỗi đọc file media: ${err.message}`));
      else resolve(metadata);
    });
  });
}

/**
 * Trích xuất audio track từ video
 * Kế thừa từ pyVideoTrans: Audio extraction command
 */
function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .audioFrequency(44100)
      .audioChannels(2)
      .on('start', (cmd) => console.log(`[Render] Trích xuất audio: ${cmd}`))
      .on('end', () => {
        console.log(`[Render] Đã trích xuất audio: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`Lỗi trích xuất audio: ${err.message}`)))
      .save(outputPath);
  });
}

/**
 * Trộn audio: nhạc nền (đã hạ volume) + voiceover
 * Kế thừa từ pyVideoTrans: Audio mixing with volume control
 * Kế thừa từ YouDub-webui: Background + Voice mix
 * 
 * @param {string} bgAudioPath - File audio nền gốc
 * @param {string} voiceoverPath - File voiceover đã tạo bởi TTS
 * @param {string} outputPath - File audio đầu ra
 * @param {object} options - { bgVolume: 0.25, voiceVolume: 1.0, useDucking: false }
 */
function mixAudio(bgAudioPath, voiceoverPath, outputPath, options = {}) {
  const bgVolume = options.bgVolume || 0.25;
  const voiceVolume = options.voiceVolume || 1.0;
  const useDucking = options.useDucking || false;
  
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const command = ffmpeg();
    command.input(bgAudioPath);    // Input 0: Background audio
    command.input(voiceoverPath);  // Input 1: Voiceover
    
    if (useDucking) {
      // Audio Ducking: Kế thừa từ pyVideoTrans
      // Tự động hạ nhạc nền khi voice đang nói
      command.complexFilter([
        {
          filter: 'asplit', options: '2',
          inputs: '1:a', outputs: ['sc', 'voice']
        },
        {
          filter: 'sidechaincompress',
          options: { threshold: 0.1, ratio: 6, attack: 20, release: 300 },
          inputs: ['0:a', 'sc'], outputs: 'ducked'
        },
        {
          filter: 'amix',
          options: { inputs: 2, duration: 'longest', dropout_transition: 2 },
          inputs: ['ducked', 'voice'], outputs: 'out'
        }
      ]);
    } else {
      // Simple volume mixing: Kế thừa từ YouDub-webui
      command.complexFilter([
        {
          filter: 'volume', options: bgVolume.toString(),
          inputs: '0:a', outputs: 'bg'
        },
        {
          filter: 'volume', options: voiceVolume.toString(),
          inputs: '1:a', outputs: 'voice'
        },
        {
          filter: 'amix',
          options: { inputs: 2, duration: 'longest', dropout_transition: 2 },
          inputs: ['bg', 'voice'], outputs: 'out'
        }
      ]);
    }
    
    command
      .outputOptions('-map [out]')
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .on('start', (cmd) => console.log(`[Render] Mix audio: ${cmd}`))
      .on('end', () => {
        console.log(`[Render] Đã trộn audio: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`Lỗi trộn audio: ${err.message}`)))
      .save(outputPath);
  });
}

/**
 * Escape đường dẫn Windows cho FFmpeg filter
 * Kế thừa kỹ thuật xử lý path từ research
 */
function escapeFilterPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return normalized.replace(/^([A-Za-z]):/, '$1\\:');
}

/**
 * Render video hoàn chỉnh: video gốc + mixed audio + phụ đề
 * Kế thừa từ pyVideoTrans + KrillinAI: Final muxing & subtitle hardcoding
 */
function renderFinal(videoPath, audioPath, subtitlePath, outputPath, options = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const command = ffmpeg();
    command.input(videoPath);  // Input 0: Video gốc
    
    if (audioPath) {
      command.input(audioPath);  // Input 1: Mixed audio
    }
    
    // Video filters
    const vFilters = [];
    
    // Phụ đề hardcoding
    if (subtitlePath && fs.existsSync(subtitlePath)) {
      const escapedPath = escapeFilterPath(subtitlePath);
      const ext = path.extname(subtitlePath).toLowerCase();
      
      if (ext === '.ass') {
        vFilters.push(`ass='${escapedPath}'`);
      } else {
        // SRT với custom style
        const fontSize = options.subtitleFontSize || 22;
        const fontName = options.subtitleFont || 'Arial';
        const forceStyle = `FontName=${fontName},FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2`;
        vFilters.push(`subtitles='${escapedPath}':force_style='${forceStyle}'`);
      }
    }
    
    if (vFilters.length > 0) {
      command.videoFilters(vFilters);
    }
    
    // Output settings
    command
      .videoCodec('libx264')
      .outputOptions([
        '-crf 20',
        '-preset fast',
        '-movflags +faststart'
      ]);
    
    if (audioPath) {
      command
        .audioCodec('aac')
        .audioBitrate('192k')
        .outputOptions([
          '-map 0:v:0',
          '-map 1:a:0'
        ]);
    } else {
      command.audioCodec('copy');
    }
    
    command
      .on('start', (cmd) => console.log(`[Render] Final render: ${cmd}`))
      .on('progress', (progress) => {
        const percent = progress.percent || 0;
        console.log(`[Render] Tiến trình: ${percent.toFixed(1)}%`);
        if (onProgress) onProgress(percent);
      })
      .on('end', () => {
        console.log(`[Render] Hoàn tất! File: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`Lỗi render video: ${err.message}`)))
      .save(outputPath);
  });
}

/**
 * Render nhanh: Chỉ thay audio (không chèn phụ đề)
 */
function replaceAudio(videoPath, audioPath, outputPath) {
  return renderFinal(videoPath, audioPath, null, outputPath);
}

module.exports = {
  getMediaInfo,
  extractAudio,
  mixAudio,
  renderFinal,
  replaceAudio,
  escapeFilterPath
};
