// ====== STATE MANAGEMENT ======
const state = {
  currentStep: 1,
  projectId: null,
  metadata: null,
  originalText: '',
  translatedText: '',
  selectedVoice: 'hoaimy',
  rate: 0,
  pitch: 0,
  bgVolume: 20,
  voiceVolume: 100,
  addSubtitles: true,
  isLoading: false,
  pollInterval: null,
  downloadUrl: null,
  // Drama Mode
  translateMode: 'tiktok', // 'tiktok' hoặc 'drama'
  dramaGenre: 'romance'
};

// ====== API HELPERS ======
async function apiCall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  console.log(`[API] ${method} ${endpoint}`);

  const response = await fetch(endpoint, options);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || `Lỗi server: ${response.status}`);
  }

  return data;
}

// ====== STEP NAVIGATION ======
function goToStep(stepNumber) {
  if (stepNumber < 1 || stepNumber > 4) return;

  if (stepNumber === 2 && !state.projectId) {
    showToast('Vui lòng phân tích video trước', 'error');
    return;
  }

  document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
  document.getElementById(`step-${stepNumber}`).classList.add('active');
  state.currentStep = stepNumber;
  updateStepIndicator();

  if (stepNumber === 4) {
    const voiceName = state.selectedVoice === 'hoaimy' ? 'Hoài My (Nữ)' : 'Nam Minh (Nam)';
    document.getElementById('summary-voice').textContent = `Giọng đọc: ${voiceName}`;
  }
}

function updateStepIndicator() {
  document.querySelectorAll('.step-item').forEach(el => {
    const step = parseInt(el.getAttribute('data-step'));
    el.classList.remove('active', 'completed');
    if (step === state.currentStep) el.classList.add('active');
    else if (step < state.currentStep) el.classList.add('completed');
  });
}

// ====== STEP 1: PARSE ======
async function parseDouyinLink() {
  const urlInput = document.getElementById('douyin-url').value;
  if (!urlInput.trim()) {
    showToast('Vui lòng nhập đường link Douyin', 'error');
    return;
  }

  const btn = document.getElementById('btn-parse');
  showLoading(btn);

  try {
    const res = await apiCall('/api/parse', 'POST', { url: urlInput });
    if (res.success) {
      state.projectId = res.projectId;
      state.metadata = res.metadata;

      // Hiển thị thông tin video
      document.getElementById('meta-title').textContent = res.metadata.title || 'Không có tiêu đề';
      document.getElementById('meta-author').textContent = res.metadata.author || 'Không rõ';
      document.getElementById('meta-likes').textContent = formatNumber(res.metadata.statistics?.likes || 0);
      document.getElementById('meta-comments').textContent = formatNumber(res.metadata.statistics?.comments || 0);
      document.getElementById('meta-shares').textContent = formatNumber(res.metadata.statistics?.shares || 0);

      // Video preview
      if (res.videoPreviewUrl) {
        const videoPlayer = document.getElementById('video-player');
        videoPlayer.src = res.videoPreviewUrl;
        videoPlayer.poster = res.metadata.coverUrl || '';
      }

      // Đưa tiêu đề gốc (tiếng Trung) vào ô dịch
      if (res.metadata.title) {
        document.getElementById('text-original').value = res.metadata.title;
        state.originalText = res.metadata.title;
      }

      document.getElementById('parse-result').classList.remove('hidden');
      showToast('Phân tích video thành công!', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoading(btn);
  }
}

// ====== TRANSLATE MODE ======
function setTranslateMode(mode) {
  state.translateMode = mode;

  document.getElementById('mode-tiktok').classList.toggle('active', mode === 'tiktok');
  document.getElementById('mode-drama').classList.toggle('active', mode === 'drama');

  const dramaOptions = document.getElementById('drama-options');
  if (mode === 'drama') {
    dramaOptions.classList.remove('hidden');
    document.getElementById('text-original').placeholder = 
      'Dán kịch bản phim ngắn tiếng Trung vào đây...\n\nVD:\n第一幕：\n男主走在街上。\n"你为什么不理我？"\n\n第二幕：\n女主回头。\n"我们已经结束了。"';
  } else {
    dramaOptions.classList.add('hidden');
    document.getElementById('text-original').placeholder = 
      'Nội dung tiếng Trung sẽ xuất hiện ở đây...';
  }
}

function selectGenre(genre, btn) {
  state.dramaGenre = genre;
  document.querySelectorAll('.genre-btn').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ====== STEP 2: TRANSLATE ======
async function translateText() {
  const originalText = document.getElementById('text-original').value;
  if (!originalText.trim()) {
    showToast('Chưa có văn bản gốc để dịch', 'error');
    return;
  }

  const btn = document.getElementById('btn-translate');
  showLoading(btn);

  try {
    let res;
    if (state.translateMode === 'drama') {
      // Gọi API dịch phim ngắn
      res = await apiCall('/api/translate/drama', 'POST', {
        text: originalText,
        genre: state.dramaGenre,
        projectId: state.projectId
      });
    } else {
      // Gọi API dịch TikTok thường
      res = await apiCall('/api/translate', 'POST', {
        text: originalText,
        context: 'video_title',
        projectId: state.projectId
      });
    }

    if (res.success) {
      document.getElementById('text-translated').value = res.translated;
      state.translatedText = res.translated;
      showToast('Dịch thuật hoàn tất!', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoading(btn);
  }
}

// ====== STEP 3: VOICEOVER ======
function selectVoice(voiceKey) {
  state.selectedVoice = voiceKey;
  document.querySelectorAll('.voice-card').forEach(el => el.classList.remove('selected'));
  document.getElementById(`voice-${voiceKey}`).classList.add('selected');
}

function updateRate(value) {
  const display = value > 0 ? `+${value}%` : `${value}%`;
  document.getElementById('val-rate').textContent = display;
  state.rate = value;
}

function updatePitch(value) {
  const display = value > 0 ? `+${value}Hz` : `${value}Hz`;
  document.getElementById('val-pitch').textContent = display;
  state.pitch = value;
}

async function previewVoice() {
  const text = document.getElementById('text-translated').value;
  if (!text.trim()) {
    showToast('Cần có bản dịch để nghe thử', 'error');
    return;
  }

  const btn = document.getElementById('btn-preview-voice');
  showLoading(btn);

  try {
    const rateStr = state.rate >= 0 ? `+${state.rate}%` : `${state.rate}%`;
    const pitchStr = state.pitch >= 0 ? `+${state.pitch}Hz` : `${state.pitch}Hz`;

    const res = await apiCall('/api/tts/preview', 'POST', {
      text: text.substring(0, 200),
      voice: state.selectedVoice,
      rate: rateStr,
      pitch: pitchStr
    });

    if (res.success && res.audioUrl) {
      const audio = document.getElementById('audio-preview');
      audio.src = res.audioUrl;
      audio.classList.remove('hidden');
      audio.play();
      showToast('Đang phát âm thanh nghe thử...', 'info');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoading(btn);
  }
}

// ====== STEP 4: RENDER ======
async function startRender() {
  const translatedText = document.getElementById('text-translated').value;
  if (!translatedText.trim()) {
    showToast('Chưa có nội dung dịch để lồng tiếng', 'error');
    return;
  }

  const btn = document.getElementById('btn-render');
  showLoading(btn);
  btn.disabled = true;
  document.getElementById('step-4-actions').classList.add('hidden');

  const rateStr = state.rate >= 0 ? `+${state.rate}%` : `${state.rate}%`;
  const pitchStr = state.pitch >= 0 ? `+${state.pitch}Hz` : `${state.pitch}Hz`;

  try {
    const res = await apiCall('/api/render', 'POST', {
      projectId: state.projectId,
      text: translatedText,
      voice: state.selectedVoice,
      rate: rateStr,
      pitch: pitchStr,
      bgVolume: document.getElementById('slider-bg-vol').value / 100,
      addSubtitles: document.getElementById('chk-subtitles').checked
    });

    if (res.success) {
      showToast('Bắt đầu render video!', 'success');
      document.getElementById('render-progress-section').classList.remove('hidden');

      // Bắt đầu poll trạng thái
      state.pollInterval = setInterval(() => pollRenderStatus(state.projectId), 2500);
    }
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    hideLoading(btn);
    document.getElementById('step-4-actions').classList.remove('hidden');
  }
}

async function pollRenderStatus(projectId) {
  try {
    const res = await apiCall(`/api/status/${projectId}`, 'GET');
    if (res.success) {
      const progressBar = document.getElementById('render-progress-bar');
      const statusText = document.getElementById('render-status-text');
      const percentage = document.getElementById('render-percentage');

      if (res.status === 'rendering') {
        statusText.textContent = 'Đang render video, vui lòng đợi...';
      }

      if (res.status === 'completed') {
        clearInterval(state.pollInterval);
        state.downloadUrl = res.outputUrl;

        progressBar.style.width = '100%';
        percentage.textContent = '100%';
        statusText.textContent = 'Hoàn tất!';

        setTimeout(() => {
          document.getElementById('btn-render').classList.add('hidden');
          document.getElementById('render-progress-section').classList.add('hidden');
          document.getElementById('download-section').classList.remove('hidden');
          showToast('Render hoàn tất! Video đã sẵn sàng tải về.', 'success');
        }, 800);
      }

      if (res.status === 'error') {
        clearInterval(state.pollInterval);
        showToast(`Lỗi render: ${res.error || 'Không xác định'}`, 'error');
        const btn = document.getElementById('btn-render');
        btn.classList.remove('hidden');
        btn.disabled = false;
        hideLoading(btn);
        document.getElementById('step-4-actions').classList.remove('hidden');
      }
    }
  } catch (err) {
    // Tiếp tục poll, không dừng
    console.warn('[Poll] Lỗi kiểm tra trạng thái:', err.message);
  }
}

function downloadVideo() {
  if (state.downloadUrl) {
    const a = document.createElement('a');
    a.href = state.downloadUrl;
    a.download = 'tiktok_video.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Đang tải video...', 'info');
  } else {
    showToast('Chưa có video để tải', 'error');
  }
}

function startNewProject() {
  state.projectId = null;
  state.metadata = null;
  state.originalText = '';
  state.translatedText = '';
  state.downloadUrl = null;
  state.translateMode = 'tiktok';
  state.dramaGenre = 'romance';
  if (state.pollInterval) clearInterval(state.pollInterval);

  document.getElementById('douyin-url').value = '';
  document.getElementById('parse-result').classList.add('hidden');
  document.getElementById('text-original').value = '';
  document.getElementById('text-translated').value = '';

  // Reset mode toggle
  setTranslateMode('tiktok');

  // Reset Step 4
  const btn = document.getElementById('btn-render');
  btn.classList.remove('hidden');
  btn.disabled = false;
  hideLoading(btn);
  document.getElementById('render-progress-section').classList.add('hidden');
  document.getElementById('download-section').classList.add('hidden');
  document.getElementById('step-4-actions').classList.remove('hidden');

  goToStep(1);
}

// ====== CONFIG ======
async function saveApiKey() {
  const key = document.getElementById('gemini-api-key').value;
  if (!key.trim()) {
    showToast('Vui lòng nhập API key', 'error');
    return;
  }

  try {
    await apiCall('/api/config', 'POST', { geminiApiKey: key });
    showToast('Đã lưu API Key thành công!', 'success');
    document.getElementById('gemini-api-key').value = '';
    document.getElementById('gemini-api-key').placeholder = '••••••••• (Đã lưu)';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ====== TOAST NOTIFICATIONS ======
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };

  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ====== UTILITIES ======
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function showLoading(el) { if (el) el.classList.add('loading'); }
function hideLoading(el) { if (el) el.classList.remove('loading'); }

// ====== INITIALIZATION ======
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[System] DouyinTikTok Studio đã khởi tạo');
  updateStepIndicator();

  // Kiểm tra trạng thái hệ thống
  try {
    const health = await apiCall('/api/health', 'GET');
    if (health.services?.translate === 'needs_api_key') {
      showToast('Cần cấu hình Gemini API Key để sử dụng dịch thuật AI', 'info');
    } else {
      console.log('[System] Tất cả services đã sẵn sàng');
    }
  } catch (err) {
    console.warn('[System] Không thể kết nối server:', err.message);
  }
});
