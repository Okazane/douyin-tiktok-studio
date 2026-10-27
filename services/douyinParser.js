const axios = require('axios');
const fs = require('fs');
const path = require('path');

// User-Agent giả lập thiết bị di động để Douyin chấp nhận request
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Trích xuất URL Douyin từ text share (có thể chứa emoji, tiếng Trung)
 * Kế thừa từ Evil0ctal: Regex pattern cho short link và full link
 */
function extractUrl(shareText) {
  // Match short links: https://v.douyin.com/xxxxx/
  const shortLinkRegex = /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_]+\/?/gi;
  // Match full links: https://www.douyin.com/video/1234567890
  const fullLinkRegex = /https?:\/\/(?:www\.)?douyin\.com\/video\/\d+/gi;
  // Match discover modal links
  const modalLinkRegex = /https?:\/\/(?:www\.)?douyin\.com\/discover\?modal_id=\d+/gi;
  
  let match = shareText.match(shortLinkRegex);
  if (match) return match[0];
  
  match = shareText.match(fullLinkRegex);
  if (match) return match[0];
  
  match = shareText.match(modalLinkRegex);
  if (match) return match[0];
  
  return null;
}

/**
 * Resolve short link (v.douyin.com) → canonical URL
 * Kế thừa từ Evil0ctal: Follow redirect với mobile UA
 */
async function resolveShortLink(shortUrl) {
  try {
    const response = await axios.get(shortUrl, {
      headers: { 'User-Agent': MOBILE_UA },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });
    return response.headers.location || response.request.res.responseUrl || shortUrl;
  } catch (error) {
    if (error.response && error.response.headers.location) {
      return error.response.headers.location;
    }
    // Try following redirects manually
    try {
      const response2 = await axios.get(shortUrl, {
        headers: { 'User-Agent': MOBILE_UA },
        maxRedirects: 5
      });
      return response2.request.res.responseUrl || shortUrl;
    } catch (e) {
      throw new Error(`Không thể resolve link Douyin: ${e.message}`);
    }
  }
}

/**
 * Trích xuất item_id (aweme_id) 19 chữ số từ URL đã resolve
 * Kế thừa từ Evil0ctal: Multiple URL pattern matching
 */
function extractItemId(fullUrl) {
  // Pattern: /video/1234567890
  let match = fullUrl.match(/\/video\/(\d+)/);
  if (match) return match[1];
  
  // Pattern: modal_id=1234567890
  match = fullUrl.match(/modal_id=(\d+)/);
  if (match) return match[1];
  
  // Pattern: /share/video/1234567890
  match = fullUrl.match(/\/share\/video\/(\d+)/);
  if (match) return match[1];
  
  // Pattern: /note/1234567890
  match = fullUrl.match(/\/note\/(\d+)/);
  if (match) return match[1];
  
  return null;
}

/**
 * Fetch thông tin video từ Douyin Web API
 * Kế thừa từ Evil0ctal: Gọi API detail endpoint
 */
async function fetchVideoData(itemId) {
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${itemId}&aid=6383&cookie_enabled=true`;
  
  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': DESKTOP_UA,
        'Referer': 'https://www.douyin.com/',
        'Accept': 'application/json',
      },
      timeout: 15000
    });
    
    const data = response.data;
    if (!data || !data.aweme_detail) {
      throw new Error('Không tìm thấy dữ liệu video');
    }
    
    return data.aweme_detail;
  } catch (error) {
    throw new Error(`Lỗi khi lấy dữ liệu video: ${error.message}`);
  }
}

/**
 * Lấy URL video không watermark
 * Kế thừa từ Evil0ctal: Trick playwm → play
 */
function getNoWatermarkUrl(awemeDetail) {
  try {
    // Ưu tiên lấy từ play_addr
    const video = awemeDetail.video;
    if (video && video.play_addr && video.play_addr.url_list) {
      let url = video.play_addr.url_list[0];
      // Trick: thay playwm thành play để lấy video không logo
      url = url.replace('playwm', 'play');
      return url;
    }
    
    // Fallback: bit_rate list
    if (video && video.bit_rate) {
      for (const br of video.bit_rate) {
        if (br.play_addr && br.play_addr.url_list) {
          let url = br.play_addr.url_list[0];
          url = url.replace('playwm', 'play');
          return url;
        }
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Trích xuất metadata đầy đủ từ aweme_detail
 */
function extractMetadata(awemeDetail) {
  const result = {
    title: awemeDetail.desc || '',
    author: awemeDetail.author?.nickname || '',
    authorId: awemeDetail.author?.unique_id || awemeDetail.author?.short_id || '',
    coverUrl: '',
    musicTitle: '',
    musicAuthor: '',
    musicUrl: '',
    duration: 0,
    videoUrl: '',
    createTime: awemeDetail.create_time || 0,
    statistics: {
      likes: awemeDetail.statistics?.digg_count || 0,
      comments: awemeDetail.statistics?.comment_count || 0,
      shares: awemeDetail.statistics?.share_count || 0,
      plays: awemeDetail.statistics?.play_count || 0,
    }
  };
  
  // Cover image
  if (awemeDetail.video?.cover?.url_list) {
    result.coverUrl = awemeDetail.video.cover.url_list[0];
  } else if (awemeDetail.video?.dynamic_cover?.url_list) {
    result.coverUrl = awemeDetail.video.dynamic_cover.url_list[0];
  }
  
  // Music/Audio
  if (awemeDetail.music) {
    result.musicTitle = awemeDetail.music.title || '';
    result.musicAuthor = awemeDetail.music.author || '';
    if (awemeDetail.music.play_url) {
      result.musicUrl = awemeDetail.music.play_url.url_list?.[0] || awemeDetail.music.play_url.uri || '';
    }
  }
  
  // Duration
  result.duration = awemeDetail.video?.duration || awemeDetail.duration || 0;
  
  // Video URL (no watermark)
  result.videoUrl = getNoWatermarkUrl(awemeDetail);
  
  return result;
}

/**
 * Download video về local
 */
async function downloadVideo(url, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const response = await axios.get(url, {
    headers: {
      'User-Agent': MOBILE_UA,
      'Referer': 'https://www.douyin.com/'
    },
    responseType: 'stream',
    timeout: 60000,
    maxRedirects: 5
  });
  
  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', reject);
  });
}

/**
 * Download audio/music track
 */
async function downloadAudio(url, outputPath) {
  return downloadVideo(url, outputPath); // Same mechanism
}

/**
 * Main parse function - Từ text share → toàn bộ thông tin video
 */
async function parseDouyinLink(inputText) {
  console.log('[DouyinParser] Đang phân tích link...');
  
  // Step 1: Trích xuất URL
  const url = extractUrl(inputText);
  if (!url) {
    throw new Error('Không tìm thấy link Douyin hợp lệ trong text đã dán');
  }
  console.log(`[DouyinParser] URL tìm được: ${url}`);
  
  // Step 2: Resolve short link nếu cần
  let fullUrl = url;
  if (url.includes('v.douyin.com')) {
    console.log('[DouyinParser] Đang resolve short link...');
    fullUrl = await resolveShortLink(url);
    console.log(`[DouyinParser] URL đầy đủ: ${fullUrl}`);
  }
  
  // Step 3: Trích xuất item_id
  const itemId = extractItemId(fullUrl);
  if (!itemId) {
    throw new Error('Không thể trích xuất ID video từ link Douyin');
  }
  console.log(`[DouyinParser] Item ID: ${itemId}`);
  
  // Step 4: Fetch video data từ API
  const awemeDetail = await fetchVideoData(itemId);
  
  // Step 5: Extract metadata
  const metadata = extractMetadata(awemeDetail);
  console.log(`[DouyinParser] Video: "${metadata.title}" by @${metadata.author}`);
  
  return metadata;
}

module.exports = {
  extractUrl,
  resolveShortLink,
  extractItemId,
  fetchVideoData,
  getNoWatermarkUrl,
  extractMetadata,
  downloadVideo,
  downloadAudio,
  parseDouyinLink
};
