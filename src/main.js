import './style.css';

const $ = (selector) => document.querySelector(selector);
const elements = {
  fileInput: $('#fileInput'), chooseButton: $('#chooseButton'), changeFile: $('#changeFile'),
  emptyState: $('#emptyState'), workspace: $('#workspace'), fileName: $('#fileName'), fileMeta: $('#fileMeta'),
  waveform: $('#waveform'), playhead: $('#playhead'), playButton: $('#playButton'), currentTime: $('#currentTime'),
  selectionDuration: $('#selectionDuration'), startTime: $('#startTime'), endTime: $('#endTime'),
  durationChip: $('#durationChip'), startRange: $('#startRange'), endRange: $('#endRange'),
  rangeFill: $('#rangeFill'), bitrate: $('#bitrate'), exportButton: $('#exportButton'), status: $('#status')
};

let audioContext;
let audioBuffer;
let audioSource;
let file;
let start = 0;
let end = 0;
let playbackStartedAt = 0;
let animationFrame;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const formatTime = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const secs = (safe % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${secs}`;
};
const formatBytes = (bytes) => bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

function stopPlayback(reset = true) {
  if (audioSource) {
    audioSource.onended = null;
    try { audioSource.stop(); } catch { /* already stopped */ }
    audioSource.disconnect();
    audioSource = null;
  }
  cancelAnimationFrame(animationFrame);
  elements.playButton.textContent = '▶';
  elements.playButton.setAttribute('aria-label', 'Reproduzir trecho');
  if (reset) {
    elements.currentTime.textContent = formatTime(0);
    setPlayhead(start);
  }
}

function setPlayhead(time) {
  if (!audioBuffer) return;
  elements.playhead.style.left = `${clamp(time / audioBuffer.duration, 0, 1) * 100}%`;
}

function updateSelection(source = '') {
  if (!audioBuffer) return;
  const duration = audioBuffer.duration;
  if (source === 'ranges') {
    start = Number(elements.startRange.value) / 100 * duration;
    end = Number(elements.endRange.value) / 100 * duration;
  } else {
    start = clamp(Number(elements.startTime.value) || 0, 0, duration);
    end = clamp(Number(elements.endTime.value) || 0, 0, duration);
  }
  if (start > end - 0.05) {
    if (source === 'start') start = Math.max(0, end - 0.05);
    else end = Math.min(duration, start + 0.05);
  }
  elements.startTime.value = start.toFixed(1);
  elements.endTime.value = end.toFixed(1);
  elements.startRange.value = (start / duration * 100).toFixed(3);
  elements.endRange.value = (end / duration * 100).toFixed(3);
  elements.rangeFill.style.left = `${start / duration * 100}%`;
  elements.rangeFill.style.width = `${(end - start) / duration * 100}%`;
  elements.selectionDuration.textContent = formatTime(end - start);
  elements.durationChip.textContent = `${(end - start).toFixed(1).replace('.', ',')} s`;
  stopPlayback();
  drawWaveform();
}

function drawWaveform() {
  if (!audioBuffer) return;
  const canvas = elements.waveform;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  const data = audioBuffer.getChannelData(0);
  const samples = Math.floor(width / 2);
  const block = Math.max(1, Math.floor(data.length / samples));

  ctx.fillStyle = '#e7e7df';
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1.25;
  for (let i = 0; i < samples; i++) {
    let min = 1, max = -1;
    const from = i * block;
    for (let j = 0; j < block; j += Math.max(1, Math.floor(block / 40))) {
      const value = data[from + j] || 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const time = i / samples * audioBuffer.duration;
    ctx.strokeStyle = time >= start && time <= end ? '#234d38' : '#aeb2aa';
    ctx.beginPath();
    ctx.moveTo(i * 2 + .5, (1 + min) * height / 2);
    ctx.lineTo(i * 2 + .5, (1 + max) * height / 2);
    ctx.stroke();
  }
}

async function loadFile(selectedFile) {
  if (!selectedFile || (!selectedFile.type.startsWith('audio/') && !selectedFile.name.match(/\.(mp3|wav|m4a|ogg|aac)$/i))) {
    elements.emptyState.classList.remove('dragging');
    alert('Escolha um arquivo de áudio válido.');
    return;
  }
  stopPlayback();
  file = selectedFile;
  elements.chooseButton.disabled = true;
  elements.chooseButton.textContent = 'Abrindo…';
  try {
    audioContext ||= new AudioContext();
    const bytes = await file.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(bytes);
    start = 0;
    end = audioBuffer.duration;
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${formatTime(audioBuffer.duration)} · ${formatBytes(file.size)} · ${audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Estéreo'}`;
    elements.startTime.max = audioBuffer.duration;
    elements.endTime.max = audioBuffer.duration;
    elements.emptyState.hidden = true;
    elements.workspace.hidden = false;
    elements.status.textContent = '';
    updateSelection();
  } catch (error) {
    console.error(error);
    alert('Não consegui abrir esse áudio. Tente outro formato ou arquivo.');
  } finally {
    elements.chooseButton.disabled = false;
    elements.chooseButton.textContent = 'Escolher áudio';
    elements.emptyState.classList.remove('dragging');
  }
}

function togglePlayback() {
  if (!audioBuffer) return;
  if (audioSource) return stopPlayback();
  audioContext.resume();
  audioSource = audioContext.createBufferSource();
  audioSource.buffer = audioBuffer;
  audioSource.connect(audioContext.destination);
  playbackStartedAt = audioContext.currentTime;
  audioSource.start(0, start, end - start);
  audioSource.onended = () => { audioSource = null; stopPlayback(); };
  elements.playButton.textContent = '■';
  elements.playButton.setAttribute('aria-label', 'Parar reprodução');

  const tick = () => {
    if (!audioSource) return;
    const elapsed = Math.min(audioContext.currentTime - playbackStartedAt, end - start);
    elements.currentTime.textContent = formatTime(elapsed);
    setPlayhead(start + elapsed);
    animationFrame = requestAnimationFrame(tick);
  };
  tick();
}

async function renderSelection() {
  const sampleRate = 44100;
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const frames = Math.ceil((end - start) * sampleRate);
  const offline = new OfflineAudioContext(channels, frames, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offline.destination);
  source.start(0, start, end - start);
  return offline.startRendering();
}

function floatTo16Bit(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = clamp(input[i], -1, 1);
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

async function exportMp3() {
  if (!audioBuffer) return;
  stopPlayback();
  elements.exportButton.disabled = true;
  elements.exportButton.textContent = 'Preparando MP3…';
  elements.status.textContent = 'Processando localmente. Áudios longos podem levar alguns segundos.';
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    const rendered = await renderSelection();
    const channels = rendered.numberOfChannels;
    const left = floatTo16Bit(rendered.getChannelData(0));
    const right = channels > 1 ? floatTo16Bit(rendered.getChannelData(1)) : null;
    const encoder = new lamejs.Mp3Encoder(channels, rendered.sampleRate, Number(elements.bitrate.value));
    const chunks = [];
    const blockSize = 1152;
    for (let i = 0; i < left.length; i += blockSize) {
      const encoded = channels === 1
        ? encoder.encodeBuffer(left.subarray(i, i + blockSize))
        : encoder.encodeBuffer(left.subarray(i, i + blockSize), right.subarray(i, i + blockSize));
      if (encoded.length) chunks.push(new Int8Array(encoded));
      if (i % (blockSize * 120) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const finalChunk = encoder.flush();
    if (finalChunk.length) chunks.push(new Int8Array(finalChunk));
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = file.name.replace(/\.[^.]+$/, '');
    link.href = url;
    link.download = `${baseName}-recorte.mp3`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    elements.status.textContent = `Pronto — MP3 criado com ${formatBytes(blob.size)}.`;
  } catch (error) {
    console.error(error);
    elements.status.textContent = 'Não foi possível gerar o MP3. Tente recortar um trecho menor.';
  } finally {
    elements.exportButton.disabled = false;
    elements.exportButton.innerHTML = '<span>↓</span> Baixar trecho em MP3';
  }
}

elements.chooseButton.addEventListener('click', (event) => { event.stopPropagation(); elements.fileInput.click(); });
elements.changeFile.addEventListener('click', () => elements.fileInput.click());
elements.emptyState.addEventListener('click', () => elements.fileInput.click());
elements.emptyState.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') elements.fileInput.click(); });
elements.fileInput.addEventListener('change', () => loadFile(elements.fileInput.files[0]));
['dragenter', 'dragover'].forEach((name) => elements.emptyState.addEventListener(name, (event) => { event.preventDefault(); elements.emptyState.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((name) => elements.emptyState.addEventListener(name, (event) => { event.preventDefault(); elements.emptyState.classList.remove('dragging'); }));
elements.emptyState.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
elements.playButton.addEventListener('click', togglePlayback);
elements.startRange.addEventListener('input', () => updateSelection('ranges'));
elements.endRange.addEventListener('input', () => updateSelection('ranges'));
elements.startTime.addEventListener('change', () => updateSelection('start'));
elements.endTime.addEventListener('change', () => updateSelection('end'));
elements.exportButton.addEventListener('click', exportMp3);
window.addEventListener('resize', drawWaveform);
