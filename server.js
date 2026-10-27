const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Import services
const douyinParser = require('./services/douyinParser');
const translateService = require('./services/translateService');
const ttsService = require('./services/ttsService');
const subtitleService = require('./services/subtitleService');
const renderService = require('./services/renderService');

const app = express();
const PORT = process.env.PORT || 3000;

// Thư mục làm việc
const TEMP_DIR = path.join(__dirname, 'temp');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Tạo thư mục nếu chưa có
[TEMP_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Phục vụ file tạm và output
app.use('/temp', express.static(TEMP_DIR));
app.use('/output', express.static(OUTPUT_DIR));

// Lưu trạng thái các project đang xử lý
const projects = new Map();

// ====== API ROUTES ======

/**
 * API: Parse link Douyin
 * POST /api/parse
 * Body: { url: "https://v.douyin.com/xxxxx" }
 */
app.post('/api/parse', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Vui lòng dán link Douyin' });
    }
    
    console.log(`\n=== [API] Parse Douyin: ${url} ===`);
    const metadata = await douyinParser.parseDouyinLink(url);
    
    // Tạo project ID
    const projectId = uuidv4();
    const projectDir = path.join(TEMP_DIR, projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    
    // Download video nếu có URL
    let localVideoPath = null;
    if (metadata.videoUrl) {
      console.log('[API] Đang tải video...');
      localVideoPath = path.join(projectDir, 'original.mp4');
      try {
        await douyinParser.downloadVideo(metadata.videoUrl, localVideoPath);
        console.log('[API] Đã tải video thành công');
      } catch (dlError) {
        console.warn('[API] Không tải được video:', dlError.message);
        localVideoPath = null;
      }
    }
    
    // Lưu project state
    projects.set(projectId, {
      id: projectId,
      metadata,
      localVideoPath,
      projectDir,
      status: 'parsed',
      createdAt: Date.now()
    });
    
    res.json({
      success: true,
      projectId,
      metadata,
      hasVideo: !!localVideoPath,
      videoPreviewUrl: localVideoPath ? `/temp/${projectId}/original.mp4` : null
    });
    
  } catch (error) {
    console.error('[API] Lỗi parse:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Dịch text Trung → Việt
 * POST /api/translate
 * Body: { text: "...", context: "video_title" | "script", projectId: "..." }
 */
app.post('/api/translate', async (req, res) => {
  try {
    const { text, context, projectId } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Vui lòng nhập text cần dịch' });
    }
    
    console.log(`\n=== [API] Dịch thuật (${context || 'general'}) ===`);
    const translated = await translateService.translateText(text, context || 'video_title');
    
    // Cập nhật project nếu có
    if (projectId && projects.has(projectId)) {
      const project = projects.get(projectId);
      project.translatedText = translated;
      project.originalText = text;
      project.status = 'translated';
    }
    
    res.json({
      success: true,
      original: text,
      translated
    });
    
  } catch (error) {
    console.error('[API] Lỗi dịch:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Dịch kịch bản nhiều dòng
 * POST /api/translate/script
 * Body: { lines: [{ text, startMs, endMs }], projectId }
 */
app.post('/api/translate/script', async (req, res) => {
  try {
    const { lines, projectId } = req.body;
    if (!lines || !lines.length) {
      return res.status(400).json({ error: 'Vui lòng nhập kịch bản cần dịch' });
    }
    
    const translated = await translateService.translateScript(lines);
    
    if (projectId && projects.has(projectId)) {
      const project = projects.get(projectId);
      project.scriptLines = translated;
      project.status = 'script_translated';
    }
    
    res.json({ success: true, lines: translated });
    
  } catch (error) {
    console.error('[API] Lỗi dịch script:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Dịch kịch bản phim ngắn
 * POST /api/translate/drama
 * Body: { text: "...", genre: "romance|comedy|drama|action|horror|historical|general", projectId }
 */
app.post('/api/translate/drama', async (req, res) => {
  try {
    const { text, genre, projectId } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Vui lòng nhập kịch bản phim cần dịch' });
    }
    
    console.log(`\n=== [API] Dịch phim ngắn (${genre || 'general'}) ===`);
    const translated = await translateService.translateDrama(text, genre || 'general');
    
    if (projectId && projects.has(projectId)) {
      const project = projects.get(projectId);
      project.translatedText = translated;
      project.originalText = text;
      project.mode = 'drama';
      project.genre = genre;
      project.status = 'translated';
    }
    
    res.json({
      success: true,
      original: text,
      translated
    });
  } catch (error) {
    console.error('[API] Lỗi dịch phim:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Lấy danh sách giọng đọc
 * GET /api/voices
 */
app.get('/api/voices', (req, res) => {
  res.json({ success: true, voices: ttsService.listVoices() });
});

/**
 * API: Tạo voiceover preview (nghe thử)
 * POST /api/tts/preview
 * Body: { text, voice, rate, pitch }
 */
app.post('/api/tts/preview', async (req, res) => {
  try {
    const { text, voice, rate, pitch } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Vui lòng nhập text để nghe thử' });
    }
    
    const previewId = uuidv4();
    const outputPath = path.join(TEMP_DIR, `preview_${previewId}.mp3`);
    
    await ttsService.generatePreview(
      text,
      voice || 'hoaimy',
      { rate: rate || '+0%', pitch: pitch || '+0Hz' },
      outputPath
    );
    
    res.json({
      success: true,
      audioUrl: `/temp/preview_${previewId}.mp3`
    });
    
  } catch (error) {
    console.error('[API] Lỗi TTS preview:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Render video hoàn chỉnh
 * POST /api/render
 * Body: { projectId, text, voice, rate, pitch, bgVolume, addSubtitles }
 */
app.post('/api/render', async (req, res) => {
  try {
    const { projectId, text, voice, rate, pitch, bgVolume, addSubtitles } = req.body;
    
    if (!projectId || !projects.has(projectId)) {
      return res.status(400).json({ error: 'Project không tồn tại. Vui lòng parse link Douyin trước.' });
    }
    
    const project = projects.get(projectId);
    
    if (!project.localVideoPath || !fs.existsSync(project.localVideoPath)) {
      return res.status(400).json({ error: 'Video chưa được tải. Vui lòng parse link lại.' });
    }
    
    project.status = 'rendering';
    const projectDir = project.projectDir;
    const voiceoverText = text || project.translatedText || '';
    
    if (!voiceoverText) {
      return res.status(400).json({ error: 'Chưa có nội dung dịch để lồng tiếng' });
    }
    
    console.log(`\n=== [API] Render video - Project: ${projectId} ===`);
    
    // Trả response ngay, xử lý render async
    res.json({ success: true, projectId, status: 'rendering' });
    
    try {
      // Step 1: Tạo voiceover
      console.log('[Render] Step 1/4: Tạo voiceover...');
      const voiceoverPath = path.join(projectDir, 'voiceover.mp3');
      await ttsService.generateVoiceover(
        voiceoverText,
        voice || 'hoaimy',
        { rate: rate || '+0%', pitch: pitch || '+0Hz' },
        voiceoverPath
      );
      
      // Step 2: Trích xuất audio nền từ video gốc
      console.log('[Render] Step 2/4: Trích xuất audio nền...');
      const bgAudioPath = path.join(projectDir, 'background.mp3');
      await renderService.extractAudio(project.localVideoPath, bgAudioPath);
      
      // Step 3: Mix audio
      console.log('[Render] Step 3/4: Trộn audio...');
      const mixedAudioPath = path.join(projectDir, 'mixed.mp3');
      await renderService.mixAudio(bgAudioPath, voiceoverPath, mixedAudioPath, {
        bgVolume: bgVolume !== undefined ? parseFloat(bgVolume) : 0.2,
        voiceVolume: 1.0,
        useDucking: false
      });
      
      // Step 3.5: Tạo phụ đề nếu yêu cầu
      let subtitlePath = null;
      if (addSubtitles !== false) {
        console.log('[Render] Tạo phụ đề...');
        // Lấy duration video
        const mediaInfo = await renderService.getMediaInfo(project.localVideoPath);
        const durationMs = (mediaInfo.format.duration || 30) * 1000;
        
        const cues = subtitleService.autoGenerateCues(voiceoverText, durationMs);
        subtitlePath = path.join(projectDir, 'subtitles.srt');
        subtitleService.generateSRT(cues, subtitlePath);
      }
      
      // Step 4: Render final video
      console.log('[Render] Step 4/4: Render video cuối cùng...');
      const outputFilename = `tiktok_${projectId.substring(0, 8)}.mp4`;
      const outputPath = path.join(OUTPUT_DIR, outputFilename);
      await renderService.renderFinal(
        project.localVideoPath,
        mixedAudioPath,
        subtitlePath,
        outputPath
      );
      
      project.outputPath = outputPath;
      project.outputUrl = `/output/${outputFilename}`;
      project.status = 'completed';
      console.log(`[Render] ✅ Hoàn tất! File: ${outputPath}`);
      
    } catch (renderError) {
      console.error('[Render] ❌ Lỗi render:', renderError.message);
      project.status = 'error';
      project.error = renderError.message;
    }
    
  } catch (error) {
    console.error('[API] Lỗi render:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Kiểm tra trạng thái render
 * GET /api/status/:projectId
 */
app.get('/api/status/:projectId', (req, res) => {
  const project = projects.get(req.params.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project không tồn tại' });
  }
  
  res.json({
    success: true,
    projectId: project.id,
    status: project.status,
    outputUrl: project.outputUrl || null,
    error: project.error || null
  });
});

/**
 * API: Cấu hình Gemini API Key
 * POST /api/config
 * Body: { geminiApiKey: "..." }
 */
app.post('/api/config', (req, res) => {
  try {
    const { geminiApiKey } = req.body;
    if (!geminiApiKey) {
      return res.status(400).json({ error: 'Vui lòng nhập Gemini API Key' });
    }
    
    translateService.initialize(geminiApiKey);
    
    // Lưu key vào file config
    const configPath = path.join(__dirname, '.env');
    fs.writeFileSync(configPath, `GEMINI_API_KEY=${geminiApiKey}\n`);
    
    res.json({ success: true, message: 'Đã lưu cấu hình Gemini API Key' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Kiểm tra trạng thái hệ thống
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'running',
    services: {
      douyinParser: 'ready',
      translate: genAIReady() ? 'ready' : 'needs_api_key',
      tts: 'ready',
      render: 'ready'
    },
    voices: ttsService.listVoices()
  });
});

function genAIReady() {
  try {
    return !!translateService;
  } catch { return false; }
}

// ====== STARTUP ======

// Tự động load API key từ .env nếu có
function loadConfig() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const match = content.match(/GEMINI_API_KEY=(.+)/);
    if (match && match[1]) {
      try {
        translateService.initialize(match[1].trim());
        console.log('[Config] Đã load Gemini API Key từ .env');
      } catch (e) {
        console.warn('[Config] API Key không hợp lệ:', e.message);
      }
    }
  } else {
    console.log('[Config] Chưa có Gemini API Key. Cấu hình qua giao diện web.');
  }
}

loadConfig();

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('  🎬 DouyinTikTok Studio đang chạy!');
  console.log(`  🌐 Mở trình duyệt: http://localhost:${PORT}`);
  console.log('  📋 Chức năng: Tải Douyin → Dịch AI → Lồng tiếng → TikTok');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
