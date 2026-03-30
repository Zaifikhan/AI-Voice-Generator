import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { Play, Download, RefreshCw, Wand2, Settings2, Volume2, Mic, Languages, Gauge, Music, Pause, Loader2, FileAudio } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const VOICES = [
  { id: 'Charon', name: 'Deep Storyteller (Male)', type: 'Male' },
  { id: 'Fenrir', name: 'Calm Motivational (Male)', type: 'Male' },
  { id: 'Zephyr', name: 'Documentary Style (Male)', type: 'Male' },
  { id: 'Kore', name: 'Emotional Storytelling (Female)', type: 'Female' },
  { id: 'Puck', name: 'Soft Inspirational (Female)', type: 'Female' },
];

const LANGUAGES = ['English', 'Urdu', 'Hindi', 'Spanish', 'Arabic', 'Indonesian'];
const EMOTIONS = ['Normal', 'Emotional', 'Dramatic', 'Suspenseful', 'Motivational', 'Horror', 'Sad'];
const SPEEDS = ['Slow', 'Normal', 'Fast'];
const PITCHES = ['Low', 'Normal', 'High'];
const BGM_OPTIONS = ['None', 'Horror', 'Emotional', 'Motivational', 'Sad'];

interface GenerationResult {
  voiceType: string;
  language: string;
  optimizedScript: string;
  voiceEmotion: string;
  audioDuration: string;
  subtitleTiming: { time: string; text: string }[];
  audioUrl: string;
}

const pcmToWav = (base64Pcm: string, sampleRate: number = 24000): string => {
  const binaryString = atob(base64Pcm);
  const pcmData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmData[i] = binaryString.charCodeAt(i);
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const chunkSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, chunkSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const pcmDataView = new Uint8Array(buffer, 44);
  pcmDataView.set(pcmData);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

export default function App() {
  const [script, setScript] = useState('');
  const [voice, setVoice] = useState(VOICES[0].id);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [emotion, setEmotion] = useState(EMOTIONS[0]);
  const [speed, setSpeed] = useState(SPEEDS[1]);
  const [pitch, setPitch] = useState(PITCHES[1]);
  const [bgm, setBgm] = useState(BGM_OPTIONS[0]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.onpause = () => setIsPlaying(false);
      audioRef.current.onplay = () => setIsPlaying(true);
    }
  }, [result]);

  const handleGenerate = async () => {
    if (!script.trim()) {
      setError('Please enter a script first.');
      return;
    }
    
    setError('');
    setIsGenerating(true);
    setResult(null);

    try {
      // Step 1: Polish Script & Generate Metadata
      const polishResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `You are an expert scriptwriter and director for YouTube Shorts and TikTok.
        
        Original Script: "${script}"
        Target Language: ${language}
        Requested Emotion: ${emotion}
        Requested Speed: ${speed}
        Requested Pitch: ${pitch}
        
        Task:
        1. Polish the script for better pacing, natural pauses (using commas, ellipses), and emotional tone suitable for a 30-40 second short video. Translate it to the target language if necessary.
        2. Detect the best overall emotion for this story if the requested one is 'Normal', otherwise adapt to the requested emotion.
        3. Generate subtitle timestamps that match the narration pacing.
        
        Return ONLY a JSON object matching this schema:`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              optimizedScript: { type: Type.STRING, description: "The polished script ready for TTS" },
              detectedEmotion: { type: Type.STRING, description: "The final emotion detected or applied" },
              subtitleTiming: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    time: { type: Type.STRING, description: "Timestamp e.g., 00:00" },
                    text: { type: Type.STRING, description: "Subtitle text" }
                  },
                  required: ["time", "text"]
                }
              }
            },
            required: ["optimizedScript", "detectedEmotion", "subtitleTiming"]
          }
        }
      });

      const polishData = JSON.parse(polishResponse.text || '{}');
      const finalScript = polishData.optimizedScript || script;
      const finalEmotion = polishData.detectedEmotion || emotion;

      // Step 2: Generate TTS
      // We instruct the TTS model with the polished script.
      // Note: Gemini TTS currently uses prebuilt voices. We pass the text directly.
      const ttsResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: finalScript }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }
            }
          }
        }
      });

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!base64Audio) {
        throw new Error("Failed to generate audio.");
      }

      const audioUrl = pcmToWav(base64Audio);
      
      // Estimate duration based on word count (avg 150 words per minute)
      const wordCount = finalScript.split(/\s+/).length;
      const estimatedSeconds = Math.round((wordCount / 150) * 60);
      const durationStr = `~${estimatedSeconds} seconds`;

      const selectedVoiceName = VOICES.find(v => v.id === voice)?.name || voice;

      setResult({
        voiceType: selectedVoiceName,
        language: language,
        optimizedScript: finalScript,
        voiceEmotion: finalEmotion,
        audioDuration: durationStr,
        subtitleTiming: polishData.subtitleTiming || [],
        audioUrl: audioUrl
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during generation.');
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const downloadAudio = (format: 'mp3' | 'wav') => {
    if (!result?.audioUrl) return;
    
    // In a real app, we might convert formats. Here we just download the WAV data URI.
    // For MP3, we'd need a client-side encoder or server, but we'll simulate by downloading the same file with a different extension for demonstration, or just provide the WAV.
    const a = document.createElement('a');
    a.href = result.audioUrl;
    a.download = `voiceover_${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
      <div className="max-w-6xl mx-auto p-6 lg:p-10">
        
        <header className="mb-10 text-center lg:text-left">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent flex items-center justify-center lg:justify-start gap-3">
            <Mic className="w-8 h-8 text-indigo-400" />
            AI Voice Over Studio
          </h1>
          <p className="text-zinc-400 mt-2 text-lg">Generate cinematic, emotional narration for your Shorts & Reels.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Input Panel */}
          <div className="lg:col-span-5 space-y-6 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800/50 backdrop-blur-sm">
            
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                <FileAudio className="w-4 h-4" />
                Script Input
              </label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your story here... (80-120 words recommended for 30s-40s)"
                className="w-full h-40 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
              />
              <div className="text-xs text-zinc-500 flex justify-between">
                <span>{script.split(/\s+/).filter(w => w.length > 0).length} words</span>
                <span>Target: 80-120 words</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Mic className="w-4 h-4" /> Voice Style
                </label>
                <select 
                  value={voice} 
                  onChange={(e) => setVoice(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                >
                  {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Languages className="w-4 h-4" /> Language
                </label>
                <select 
                  value={language} 
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                >
                  {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Wand2 className="w-4 h-4" /> Emotion
                </label>
                <select 
                  value={emotion} 
                  onChange={(e) => setEmotion(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                >
                  {EMOTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Gauge className="w-4 h-4" /> Speed
                </label>
                <select 
                  value={speed} 
                  onChange={(e) => setSpeed(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                >
                  {SPEEDS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Settings2 className="w-4 h-4" /> Pitch
                </label>
                <select 
                  value={pitch} 
                  onChange={(e) => setPitch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                >
                  {PITCHES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Music className="w-4 h-4" /> Background Music
                </label>
                <select 
                  value={bgm} 
                  onChange={(e) => setBgm(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                >
                  {BGM_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating Magic...
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  Generate Voiceover
                </>
              )}
            </button>
          </div>

          {/* Output Panel */}
          <div className="lg:col-span-7">
            {result ? (
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 lg:p-8 backdrop-blur-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Player Section */}
                <div className="bg-zinc-950 rounded-xl p-6 border border-zinc-800 flex flex-col items-center gap-6">
                  <audio ref={audioRef} src={result.audioUrl} className="hidden" />
                  
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 flex items-center justify-center border border-indigo-500/30 relative">
                    <div className={`absolute inset-0 rounded-full border-2 border-indigo-500/50 ${isPlaying ? 'animate-ping opacity-20' : 'opacity-0'}`}></div>
                    <button 
                      onClick={togglePlay}
                      className="w-16 h-16 bg-indigo-500 hover:bg-indigo-400 rounded-full flex items-center justify-center text-white transition-colors shadow-lg shadow-indigo-500/20 z-10"
                    >
                      {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
                    </button>
                  </div>

                  <div className="flex gap-3 w-full justify-center">
                    <button 
                      onClick={() => downloadAudio('mp3')}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                    >
                      <Download className="w-4 h-4" /> MP3
                    </button>
                    <button 
                      onClick={() => downloadAudio('wav')}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                    >
                      <Download className="w-4 h-4" /> WAV
                    </button>
                    <button 
                      onClick={handleGenerate}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" /> Regenerate
                    </button>
                  </div>
                </div>

                {/* Metadata Section */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Voice Type</div>
                    <div className="font-medium text-sm text-zinc-200">{result.voiceType}</div>
                  </div>
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Language</div>
                    <div className="font-medium text-sm text-zinc-200">{result.language}</div>
                  </div>
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Emotion</div>
                    <div className="font-medium text-sm text-zinc-200">{result.voiceEmotion}</div>
                  </div>
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Duration</div>
                    <div className="font-medium text-sm text-zinc-200">{result.audioDuration}</div>
                  </div>
                </div>

                {/* Script & Subtitles */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                      <Wand2 className="w-4 h-4" /> Optimized Script
                    </h3>
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-sm text-zinc-300 leading-relaxed h-64 overflow-y-auto">
                      {result.optimizedScript}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                      <Volume2 className="w-4 h-4" /> Subtitle Timing
                    </h3>
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-sm text-zinc-300 h-64 overflow-y-auto space-y-3">
                      {result.subtitleTiming.map((sub, idx) => (
                        <div key={idx} className="flex gap-3">
                          <span className="text-indigo-400 font-mono shrink-0">{sub.time}</span>
                          <span className="text-zinc-300">{sub.text}</span>
                        </div>
                      ))}
                      {result.subtitleTiming.length === 0 && (
                        <div className="text-zinc-500 italic">No timing data available.</div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-zinc-500 border-2 border-dashed border-zinc-800/50 rounded-2xl bg-zinc-900/20">
                <Mic className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-lg font-medium">Your generated voiceover will appear here</p>
                <p className="text-sm mt-2 opacity-60">Fill out the details and click generate to start</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
