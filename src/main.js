import './style.css';

const $ = (selector) => document.querySelector(selector);
const elements = {
  fileInput: $('#fileInput'), chooseButton: $('#chooseButton'), changeFile: $('#changeFile'),
  emptyState: $('#emptyState'), workspace: $('#workspace'), fileName: $('#fileName'), fileMeta: $('#fileMeta'),
  waveform: $('#waveform'), playhead: $('#playhead'), playButton: $('#playButton'), currentTime: $('#currentTime'),
  selectionDuration: $('#selectionDuration'), startTime: $('#startTime'), endTime: $('#endTime'),
  segmentEditorTitle: $('#segmentEditorTitle'), durationChip: $('#durationChip'), startRange: $('#startRange'),
  endRange: $('#endRange'), rangeFill: $('#rangeFill'), addSegment: $('#addSegment'),
  segmentsList: $('#segmentsList'), bitrate: $('#bitrate'), exportButton: $('#exportButton'), status: $('#status')
};

let audioContext;
let audioBuffer;
let audioSource;
let file;
let segments = [];
let activeSegmentIndex = 0;
let playbackStartedAt = 0;
let animationFrame;
let renderedSelectionCache;
let selectionVersion = 0;
let preparingPlayback = false;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const segmentDuration = (segment) => Math.max(0, segment.end - segment.start);
const totalDuration = () => segments.reduce((total, segment) => total + segmentDuration(segment), 0);
const activeSegment = () => segments[activeSegmentIndex];
const formatTime = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const secs = (safe % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${secs}`;
};
const formatBytes = (bytes) => bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

function invalidateRenderedSelection() {
  renderedSelectionCache = null;
  selectionVersion += 1;
}

function setPlayhead(time) {
  if (!audioBuffer) return;
  elements.playhead.style.left = `${clamp(time / audioBuffer.duration, 0, 1) * 100}%`;
}

function stopPlayback(reset = true) {
  if (audioSource) {
    audioSource.onended = null;
    try { audioSource.stop(); } catch { /* already stopped */ }
    audioSource.disconnect();
    audioSource = null;
  }
  cancelAnimationFrame(animationFrame);
  preparingPlayback = false;
  elements.playButton.disabled = false;
  elements.playButton.textContent = '▶';
  elements.playButton.setAttribute('aria-label', 'Reproduzir áudio final');
  if (reset && activeSegment()) {
    elements.currentTime.textContent = formatTime(0);
    setPlayhead(activeSegment().start);
  }
}

function normalizeSegment(segment, changedField = 'end') {
  const duration = audioBuffer.duration;
  segment.start = clamp(Number(segment.start) || 0, 0, duration);
  segment.end = clamp(Number(segment.end) || 0, 0, duration);
  if (segment.start > segment.end - 0.05) {
    if (changedField === 'start') segment.start = Math.max(0, segment.end - 0.05);
    else {
      segment.end = Math.min(duration, segment.start + 0.05);
      if (segment.end - segment.start < 0.05) segment.start = Math.max(0, segment.end - 0.05);
    }
  }
}

function syncEditor() {
  const segment = activeSegment();
  if (!audioBuffer || !segment) return;
  const duration = audioBuffer.duration;
  elements.segmentEditorTitle.textContent = `Trecho ${activeSegmentIndex + 1} · início`;
  elements.startTime.value = segment.start.toFixed(1);
  elements.endTime.value = segment.end.toFixed(1);
  elements.startRange.value = (segment.start / duration * 100).toFixed(3);
  elements.endRange.value = (segment.end / duration * 100).toFixed(3);
  elements.rangeFill.style.left = `${segment.start / duration * 100}%`;
  elements.rangeFill.style.width = `${segmentDuration(segment) / duration * 100}%`;
  elements.selectionDuration.textContent = formatTime(totalDuration());
  elements.durationChip.textContent = `${segmentDuration(segment).toFixed(1).replace('.', ',')} s`;
}

function updateSelection(source = '') {
  if (!audioBuffer || !activeSegment()) return;
  const segment = activeSegment();
  const duration = audioBuffer.duration;
  if (source === 'ranges') {
    segment.start = Number(elements.startRange.value) / 100 * duration;
    segment.end = Number(elements.endRange.value) / 100 * duration;
  } else {
    segment.start = Number(elements.startTime.value) || 0;
    segment.end = Number(elements.endTime.value) || 0;
  }
  normalizeSegment(segment, source);
  invalidateRenderedSelection();
  stopPlayback();
  syncEditor();
  renderSegments();
  drawWaveform();
}

function selectSegment(index) {
  if (!segments[index]) return;
  activeSegmentIndex = index;
  stopPlayback();
  syncEditor();
  renderSegments();
  drawWaveform();
}

function focusSegment(index, row) {
  if (!segments[index] || index === activeSegmentIndex) return;
  activeSegmentIndex = index;
  stopPlayback();
  syncEditor();
  elements.segmentsList.querySelectorAll('.segment-row').forEach((segmentRow) => segmentRow.classList.remove('active'));
  row.classList.add('active');
  drawWaveform();
}

function updateSegmentFromList(index, field, value) {
  const segment = segments[index];
  if (!segment) return;
  activeSegmentIndex = index;
  segment[field] = Number(value) || 0;
  normalizeSegment(segment, field);
  invalidateRenderedSelection();
  stopPlayback();
  syncEditor();
  renderSegments();
  drawWaveform();
}

function moveSegment(index, direction) {
  const target = index + direction;
  if (!segments[index] || !segments[target]) return;
  [segments[index], segments[target]] = [segments[target], segments[index]];
  activeSegmentIndex = target;
  invalidateRenderedSelection();
  stopPlayback();
  syncEditor();
  renderSegments();
  drawWaveform();
}

function removeSegment(index) {
  if (segments.length === 1) return;
  segments.splice(index, 1);
  activeSegmentIndex = Math.min(index, segments.length - 1);
  invalidateRenderedSelection();
  stopPlayback();
  syncEditor();
  renderSegments();
  drawWaveform();
}

function renderSegments() {
  elements.segmentsList.replaceChildren();
  segments.forEach((segment, index) => {
    const row = document.createElement('div');
    row.className = `segment-row${index === activeSegmentIndex ? ' active' : ''}`;
    row.innerHTML = `
      <button class="segment-name" type="button">Trecho ${index + 1}</button>
      <label class="segment-field">Início<input class="segment-start" type="number" min="0" max="${audioBuffer.duration}" step="0.1" value="${segment.start.toFixed(1)}"></label>
      <span class="segment-separator">—</span>
      <label class="segment-field">Fim<input class="segment-end" type="number" min="0" max="${audioBuffer.duration}" step="0.1" value="${segment.end.toFixed(1)}"></label>
      <span class="segment-length">${formatTime(segmentDuration(segment))}</span>
      <span class="segment-actions">
        <button class="segment-action segment-up" type="button" aria-label="Mover trecho para cima" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="segment-action segment-down" type="button" aria-label="Mover trecho para baixo" ${index === segments.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="segment-action segment-remove" type="button" aria-label="Remover trecho" ${segments.length === 1 ? 'disabled' : ''}>×</button>
      </span>`;
    row.querySelector('.segment-name').addEventListener('click', () => selectSegment(index));
    row.querySelector('.segment-start').addEventListener('focus', () => focusSegment(index, row));
    row.querySelector('.segment-end').addEventListener('focus', () => focusSegment(index, row));
    row.querySelector('.segment-start').addEventListener('change', (event) => updateSegmentFromList(index, 'start', event.target.value));
    row.querySelector('.segment-end').addEventListener('change', (event) => updateSegmentFromList(index, 'end', event.target.value));
    row.querySelector('.segment-up').addEventListener('click', () => moveSegment(index, -1));
    row.querySelector('.segment-down').addEventListener('click', () => moveSegment(index, 1));
    row.querySelector('.segment-remove').addEventListener('click', () => removeSegment(index));
    elements.segmentsList.append(row);
  });
}

function addSegment() {
  if (!audioBuffer) return;
  const last = segments.at(-1);
  let start = last && last.end < audioBuffer.duration - 0.05 ? last.end : 0;
  let end = Math.min(audioBuffer.duration, start + 10);
  if (end - start < 0.05) {
    start = 0;
    end = Math.min(audioBuffer.duration, 10);
  }
  segments.push({ start, end });
  activeSegmentIndex = segments.length - 1;
  invalidateRenderedSelection();
  stopPlayback();
  syncEditor();
  renderSegments();
  drawWaveform();
  elements.segmentsList.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    const isActive = activeSegment() && time >= activeSegment().start && time <= activeSegment().end;
    const isSelected = segments.some((segment) => time >= segment.start && time <= segment.end);
    ctx.strokeStyle = isActive ? '#234d38' : isSelected ? '#718a77' : '#aeb2aa';
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
    segments = [{ start: 0, end: audioBuffer.duration }];
    activeSegmentIndex = 0;
    invalidateRenderedSelection();
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${formatTime(audioBuffer.duration)} · ${formatBytes(file.size)} · ${audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Estéreo'}`;
    elements.startTime.max = audioBuffer.duration;
    elements.endTime.max = audioBuffer.duration;
    elements.emptyState.hidden = true;
    elements.workspace.hidden = false;
    elements.status.textContent = '';
    syncEditor();
    renderSegments();
    drawWaveform();
  } catch (error) {
    console.error(error);
    alert('Não consegui abrir esse áudio. Tente outro formato ou arquivo.');
  } finally {
    elements.chooseButton.disabled = false;
    elements.chooseButton.textContent = 'Escolher áudio';
    elements.emptyState.classList.remove('dragging');
  }
}

function originalTimeAtElapsed(elapsed) {
  let remaining = elapsed;
  for (const segment of segments) {
    const duration = segmentDuration(segment);
    if (remaining <= duration) return segment.start + remaining;
    remaining -= duration;
  }
  return segments.at(-1)?.end || 0;
}

async function togglePlayback() {
  if (!audioBuffer || preparingPlayback) return;
  if (audioSource) return stopPlayback();
  preparingPlayback = true;
  elements.playButton.disabled = true;
  elements.playButton.textContent = '…';
  try {
    const rendered = await getRenderedSelection();
    await audioContext.resume();
    const source = audioContext.createBufferSource();
    audioSource = source;
    source.buffer = rendered;
    source.connect(audioContext.destination);
    playbackStartedAt = audioContext.currentTime;
    source.start();
    source.onended = () => {
      if (audioSource === source) {
        audioSource = null;
        stopPlayback();
      }
    };
    preparingPlayback = false;
    elements.playButton.disabled = false;
    elements.playButton.textContent = '■';
    elements.playButton.setAttribute('aria-label', 'Parar reprodução');

    const tick = () => {
      if (audioSource !== source) return;
      const elapsed = Math.min(audioContext.currentTime - playbackStartedAt, totalDuration());
      elements.currentTime.textContent = formatTime(elapsed);
      setPlayhead(originalTimeAtElapsed(elapsed));
      animationFrame = requestAnimationFrame(tick);
    };
    tick();
  } catch (error) {
    console.error(error);
    stopPlayback();
    elements.status.textContent = 'Não foi possível preparar a prévia dos trechos.';
  }
}

async function renderSelection() {
  const sampleRate = 44100;
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const frames = Math.max(1, Math.ceil(totalDuration() * sampleRate));
  const offline = new OfflineAudioContext(channels, frames, sampleRate);
  let outputTime = 0;
  for (const segment of segments) {
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start(outputTime, segment.start, segmentDuration(segment));
    outputTime += segmentDuration(segment);
  }
  return offline.startRendering();
}

async function getRenderedSelection() {
  if (renderedSelectionCache) return renderedSelectionCache;
  const version = selectionVersion;
  const rendered = await renderSelection();
  if (version === selectionVersion) renderedSelectionCache = rendered;
  return rendered;
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
  elements.exportButton.textContent = 'Unindo e preparando MP3…';
  elements.status.textContent = `Unindo ${segments.length} ${segments.length === 1 ? 'trecho' : 'trechos'} localmente.`;
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    const rendered = await getRenderedSelection();
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
    link.download = `${baseName}-recortes.mp3`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    elements.status.textContent = `Pronto — ${segments.length} ${segments.length === 1 ? 'trecho unido' : 'trechos unidos'} em ${formatTime(totalDuration())}.`;
  } catch (error) {
    console.error(error);
    elements.status.textContent = 'Não foi possível gerar o MP3. Tente usar menos trechos.';
  } finally {
    elements.exportButton.disabled = false;
    elements.exportButton.innerHTML = '<span>↓</span> Baixar áudio final em MP3';
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
elements.addSegment.addEventListener('click', addSegment);
elements.exportButton.addEventListener('click', exportMp3);
window.addEventListener('resize', drawWaveform);
