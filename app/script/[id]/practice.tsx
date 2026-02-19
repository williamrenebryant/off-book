import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  Animated,
  Alert,
  Linking,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getScript, getProgress, saveProgress, initProgress, getSettings, saveScript } from '@/lib/storage';
import { evaluateLine, getHint, getCoachingQuestion } from '@/lib/claude';
import { evaluateLineViaBackend, getHintViaBackend, getCoachingViaBackend } from '@/lib/backend';
import { Script, Scene, Line, ScriptProgress, LineProgress, FeedbackResult, AppSettings } from '@/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';

// Returns what fraction of the correct line's words appear in the spoken text.
// Ignores punctuation and case. Used for fuzzy pre-screening and picking the
// best alternative from speech recognition.
function wordSimilarity(spoken: string, correct: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, '').trim().split(/\s+/).filter(Boolean);
  const spokenWords = normalize(spoken);
  const correctWords = normalize(correct);
  if (correctWords.length === 0) return 1;
  if (spokenWords.length === 0) return 0;
  const spokenSet = new Set(spokenWords);
  return correctWords.filter(w => spokenSet.has(w)).length / correctWords.length;
}

// Given multiple STT alternatives, return the one that best matches the correct line.
function pickBestAlternative(alternatives: string[], correctText: string): string {
  if (alternatives.length <= 1) return alternatives[0] ?? '';
  return alternatives.reduce((best, alt) =>
    wordSimilarity(alt, correctText) > wordSimilarity(best, correctText) ? alt : best
  );
}

interface SceneModeConfig {
  type: 'flow' | 'drill';
  threshold: number; // 70, 80, or 90
  lineCount: number | null; // null = all
}

interface SceneModeResult {
  lineId: string;
  lineText: string;
  spokenText: string;
  score: number;
  feedback: string;
}

type PracticeState =
  | 'practice_idle'
  | 'practice_speaking'
  | 'cue'
  | 'listening'
  | 'evaluating'
  | 'feedback'
  | 'complete';

export default function PracticeScreen() {
  const { id, sceneId } = useLocalSearchParams<{ id: string; sceneId: string }>();
  const router = useRouter();

  const [script, setScript] = useState<Script | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [myLines, setMyLines] = useState<Line[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [practiceState, setPracticeState] = useState<PracticeState>('practice_idle');
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState<FeedbackResult | null>(null);
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [hintText, setHintText] = useState('');
  const [progress, setProgress] = useState<ScriptProgress | null>(null);
  const [coachingQuestion, setCoachingQuestion] = useState('');
  const [showLine, setShowLine] = useState(false);
  const [lineModes, setLineModes] = useState<Record<string, 'practice' | 'test'>>({});

  // Scene mode state
  const [sceneConfig, setSceneConfig] = useState<SceneModeConfig | null>(null);
  const [showSceneConfig, setShowSceneConfig] = useState(false);
  const [sceneModeResults, setSceneModeResults] = useState<SceneModeResult[]>([]);
  const [configType, setConfigType] = useState<'flow' | 'drill'>('flow');
  const [configThreshold, setConfigThreshold] = useState(80);
  const [configLineCount, setConfigLineCount] = useState<number | null>(null);
  const [autoAdvancing, setAutoAdvancing] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  // Avoid stale closures in speech/timer handlers
  const practiceStateRef = useRef<PracticeState>('practice_idle');
  const currentLineRef = useRef<Line | null>(null);
  const myLinesRef = useRef<Line[]>([]);
  const currentIndexRef = useRef(0);
  const sceneConfigRef = useRef<SceneModeConfig | null>(null);
  const allMyLinesRef = useRef<Line[]>([]); // full, unfiltered line set for this character

  // Transcript tracking
  const interimTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const hasFinalRef = useRef(false);
  const allAlternativesRef = useRef<string[]>([]);
  const calledForLineRef = useRef(false); // signals end handler to skip evaluation
  // Accumulated transcript across STT restarts (iOS stops on silence even with continuous: true)
  const accumulatedTranscriptRef = useRef('');
  const langRef = useRef('en-US');

  // Timing
  const listeningStartRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPracticeStateAndRef = (s: PracticeState) => {
    practiceStateRef.current = s;
    setPracticeState(s);
  };

  // Keep refs in sync with state
  useEffect(() => {
    currentLineRef.current = myLines[currentIndex] ?? null;
  }, [myLines, currentIndex]);

  useEffect(() => {
    myLinesRef.current = myLines;
  }, [myLines]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    sceneConfigRef.current = sceneConfig;
  }, [sceneConfig]);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    // Show accumulated text + current segment so the display doesn't flicker on restart
    const display = accumulatedTranscriptRef.current
      ? accumulatedTranscriptRef.current + ' ' + text
      : text;
    setTranscript(display);
    interimTranscriptRef.current = text; // current segment only
    // Always capture the latest alternatives so best-match works even if
    // the recognizer ends before delivering a final result.
    const alts = (event.results as any[]).map((r: any) => r.transcript).filter(Boolean);
    if (alts.length > 0) allAlternativesRef.current = alts;
    if (event.isFinal) {
      hasFinalRef.current = true;
      finalTranscriptRef.current = text;
    }
  });

  useSpeechRecognitionEvent('end', () => {
    const state = practiceStateRef.current;
    stopPulse();

    if (state === 'practice_speaking') {
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
      if (listeningStartRef.current) {
        const dur = Date.now() - listeningStartRef.current;
        listeningStartRef.current = null;
        const spokenText = interimTranscriptRef.current || undefined;
        updateLineProgress(currentLineRef.current!.id, {
          practiceDuration: dur,
          practiceTranscript: spokenText,
        });
      }
      setPracticeStateAndRef('practice_idle');
    } else if (state === 'listening') {
      if (calledForLineRef.current) {
        calledForLineRef.current = false;
        accumulatedTranscriptRef.current = '';
        if (autoStopTimerRef.current) {
          clearTimeout(autoStopTimerRef.current);
          autoStopTimerRef.current = null;
        }
        setPracticeStateAndRef('cue');
        return;
      }

      const segmentText = hasFinalRef.current
        ? finalTranscriptRef.current
        : interimTranscriptRef.current;

      // If our max-stop timer is still running, this was a premature silence stop.
      // Accumulate what we have and restart so iOS doesn't cut off long lines.
      if (autoStopTimerRef.current !== null && segmentText) {
        accumulatedTranscriptRef.current = (
          accumulatedTranscriptRef.current + ' ' + segmentText
        ).trim();
        interimTranscriptRef.current = '';
        finalTranscriptRef.current = '';
        hasFinalRef.current = false;
        allAlternativesRef.current = [];
        ExpoSpeechRecognitionModule.start({
          lang: langRef.current,
          interimResults: true,
          maxAlternatives: 3,
          continuous: true,
        });
        return;
      }

      // Timer fired (null) or user tapped stop (null) — evaluate the full text.
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
      const fullText = segmentText
        ? (accumulatedTranscriptRef.current + ' ' + segmentText).trim()
        : accumulatedTranscriptRef.current;
      accumulatedTranscriptRef.current = '';

      if (fullText) {
        // For accumulated multi-segment text, skip per-segment alternatives and
        // evaluate the full string directly.
        const textToEval = accumulatedTranscriptRef.current
          ? fullText
          : (() => {
              const alts = allAlternativesRef.current;
              return alts.length > 1 && currentLineRef.current
                ? pickBestAlternative(alts, currentLineRef.current.text)
                : fullText;
            })();
        setTranscript(textToEval);
        handleEvaluate(textToEval);
      } else {
        setPracticeStateAndRef('cue');
      }
    }
  });

  useEffect(() => {
    if (!id || !sceneId) return;
    Promise.all([getScript(id), getProgress(id), getSettings()]).then(
      ([s, p, set]) => {
        if (!s) return;
        setScript(s);
        setSettings(set);

        const foundScene = s.scenes.find((sc) => sc.id === sceneId);
        if (!foundScene) return;
        setScene(foundScene);

        const lines = foundScene.lines.filter((l) => l.character === s.selectedCharacter);
        setMyLines(lines);
        myLinesRef.current = lines;
        allMyLinesRef.current = lines;

        const resolvedProgress = p ?? initProgress(s.id, s.selectedCharacter ?? '');
        setProgress(resolvedProgress);

        const modes: Record<string, 'practice' | 'test'> = {};
        lines.forEach(l => {
          modes[l.id] = resolvedProgress.sceneProgress[sceneId]?.lineProgress[l.id]?.readyForTest
            ? 'test' : 'practice';
        });
        setLineModes(modes);

        const firstMode = modes[lines[0]?.id] ?? 'practice';
        setPracticeStateAndRef(firstMode === 'test' ? 'cue' : 'practice_idle');
      }
    );
  }, [id, sceneId]);

  useEffect(() => {
    return () => {
      Speech.stop();
      ExpoSpeechRecognitionModule.stop();
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, []);

  const currentLine = myLines[currentIndex];
  const currentMode = lineModes[currentLine?.id ?? ''] ?? 'practice';

  const startListening = async (mode: 'practice' | 'test') => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Microphone Required',
        'Please allow microphone access in Settings to practice your lines.'
      );
      return;
    }

    setTranscript('');
    interimTranscriptRef.current = '';
    finalTranscriptRef.current = '';
    hasFinalRef.current = false;
    allAlternativesRef.current = [];
    accumulatedTranscriptRef.current = '';
    langRef.current = settings?.speechLanguage ?? 'en-US';
    startPulse();

    if (mode === 'practice') {
      listeningStartRef.current = Date.now();
      setPracticeStateAndRef('practice_speaking');
    } else {
      setPracticeStateAndRef('listening');
      const pd = progress?.sceneProgress[sceneId]?.lineProgress[currentLine?.id ?? '']?.practiceDuration;
      // Always set a max-stop timer. Setting it to null when it fires signals the
      // end handler that this was a max-duration stop (not a premature silence stop).
      const maxMs = pd ? pd * 1.5 + 3000 : 30000;
      autoStopTimerRef.current = setTimeout(() => {
        autoStopTimerRef.current = null; // mark as "max-timer fired" for end handler
        ExpoSpeechRecognitionModule.stop();
      }, maxMs);
    }

    ExpoSpeechRecognitionModule.start({
      lang: langRef.current,
      interimResults: true,
      maxAlternatives: 3,
      continuous: true,
    });
  };

  const stopListening = () => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    stopPulse();
    ExpoSpeechRecognitionModule.stop();
    // 'end' handler drives the rest
  };

  const startPulse = () => {
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulseRef.current.start();
  };

  const stopPulse = () => {
    pulseRef.current?.stop();
    pulseAnim.setValue(1);
  };

  const updateLineProgress = (lineId: string, updates: Partial<LineProgress>) => {
    setProgress(prev => {
      if (!prev) return prev;
      const sp = prev.sceneProgress[sceneId] ?? { sceneId, lineProgress: {} };
      const existing = sp.lineProgress[lineId] ?? {
        lineId, attempts: 0, correctAttempts: 0, lastPracticed: '', mastered: false,
      };
      const updated = { ...existing, ...updates, lastPracticed: new Date().toISOString() };
      const newProgress = {
        ...prev,
        lastPracticed: new Date().toISOString(),
        sceneProgress: {
          ...prev.sceneProgress,
          [sceneId]: { ...sp, lineProgress: { ...sp.lineProgress, [lineId]: updated } },
        },
      };
      saveProgress(newProgress);
      return newProgress;
    });
  };

  // Advances to the next line using refs (safe for timer callbacks)
  const advanceToNextLine = () => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setAutoAdvancing(false);
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex >= myLinesRef.current.length) {
      setPracticeStateAndRef('complete');
    } else {
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      setFeedback(null);
      setTranscript('');
      setHintText('');
      setHintLevel(0);
      setShowLine(false);
      setCoachingQuestion('');
      setPracticeStateAndRef('cue');
    }
  };

  const handleEvaluate = async (spokenText: string) => {
    if (!currentLineRef.current) return;
    stopPulse();
    setPracticeStateAndRef('evaluating');

    try {
      const context = scene?.title ?? '';
      let result: FeedbackResult;

      // Fuzzy pre-screen: if the spoken text covers ≥90% of the correct line's
      // words, auto-pass without an API call. Also check against the stored
      // practice transcript in case the actor's pronunciation is consistently
      // different from the written text (e.g. accents, contractions).
      const lineProgress = progress?.sceneProgress[sceneId]?.lineProgress[currentLineRef.current.id];
      const practiceRef = lineProgress?.practiceTranscript;
      const directSimilarity = wordSimilarity(spokenText, currentLineRef.current.text);
      const practiceSimilarity = practiceRef
        ? wordSimilarity(spokenText, practiceRef) * wordSimilarity(practiceRef, currentLineRef.current.text)
        : 0;

      if (directSimilarity >= 1.0) {
        result = { accurate: true, score: 100, feedback: 'Perfect!' };
      } else if (directSimilarity >= 0.9 || practiceSimilarity >= 0.82) {
        result = { accurate: true, score: 96, feedback: 'Nailed it!' };
      } else if (settings?.anthropicApiKey) {
        result = await evaluateLine(
          settings.anthropicApiKey,
          spokenText,
          currentLineRef.current.text,
          script?.selectedCharacter ?? '',
          context
        );
      } else if (script?.scriptToken) {
        result = await evaluateLineViaBackend(
          script.scriptToken,
          spokenText,
          currentLineRef.current.text,
          script?.selectedCharacter ?? '',
          context
        );
      } else {
        Alert.alert(
          'Setup Required',
          'This script was added before in-app purchases were available. Please add your Anthropic API key in Settings, or delete and re-upload this script.',
          [{ text: 'OK' }]
        );
        setPracticeStateAndRef('cue');
        return;
      }

      setFeedback(result);
      setHintText('');
      setHintLevel(0);
      setShowLine(false);
      setPracticeStateAndRef('feedback');
      updateLineProgress(currentLineRef.current.id, {
        attempts: (progress?.sceneProgress[sceneId]?.lineProgress[currentLineRef.current.id]?.attempts ?? 0) + 1,
        correctAttempts: (progress?.sceneProgress[sceneId]?.lineProgress[currentLineRef.current.id]?.correctAttempts ?? 0) + (result.score >= 90 ? 1 : 0),
        mastered: ((progress?.sceneProgress[sceneId]?.lineProgress[currentLineRef.current.id]?.correctAttempts ?? 0) + (result.score >= 90 ? 1 : 0)) >= 3,
      });

      // Scene mode: record result and handle auto-advance
      const cfg = sceneConfigRef.current;
      if (cfg && currentLineRef.current) {
        const smResult: SceneModeResult = {
          lineId: currentLineRef.current.id,
          lineText: currentLineRef.current.text,
          spokenText,
          score: result.score,
          feedback: result.feedback,
        };
        setSceneModeResults(prev => [...prev, smResult]);

        // Flow: always auto-advance after 1.5s
        // Drill: auto-advance only if at or above threshold; otherwise wait for user
        if (cfg.type === 'flow' || result.score >= cfg.threshold) {
          setAutoAdvancing(true);
          autoAdvanceTimerRef.current = setTimeout(advanceToNextLine, 1500);
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
      setPracticeStateAndRef('cue');
    }
  };

  const handleStartSceneMode = () => {
    const cfg: SceneModeConfig = {
      type: configType,
      threshold: configThreshold,
      lineCount: configLineCount,
    };
    setSceneConfig(cfg);
    sceneConfigRef.current = cfg;
    setSceneModeResults([]);
    setShowSceneConfig(false);

    // Slice lines if lineCount is set
    const allLines = allMyLinesRef.current;
    const activeLines = configLineCount ? allLines.slice(0, configLineCount) : allLines;
    setMyLines(activeLines);
    myLinesRef.current = activeLines;

    // All lines go to test mode in scene mode
    const testModes: Record<string, 'practice' | 'test'> = {};
    activeLines.forEach(l => { testModes[l.id] = 'test'; });
    setLineModes(testModes);

    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setFeedback(null);
    setTranscript('');
    setHintText('');
    setHintLevel(0);
    setShowLine(false);
    setCoachingQuestion('');
    setPracticeStateAndRef('cue');
  };

  const handleRunSceneAgain = () => {
    if (!sceneConfig) return;
    setSceneModeResults([]);
    const allLines = allMyLinesRef.current;
    const activeLines = sceneConfig.lineCount ? allLines.slice(0, sceneConfig.lineCount) : allLines;
    setMyLines(activeLines);
    myLinesRef.current = activeLines;
    const testModes: Record<string, 'practice' | 'test'> = {};
    activeLines.forEach(l => { testModes[l.id] = 'test'; });
    setLineModes(testModes);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setFeedback(null);
    setTranscript('');
    setHintText('');
    setHintLevel(0);
    setShowLine(false);
    setCoachingQuestion('');
    setPracticeStateAndRef('cue');
  };

  const handlePracticeWeakLines = () => {
    if (!sceneConfig) return;
    const weakLineIds = new Set(
      sceneModeResults
        .filter(r => r.score < sceneConfig.threshold)
        .map(r => r.lineId)
    );
    const weakLines = allMyLinesRef.current.filter(l => weakLineIds.has(l.id));
    if (weakLines.length === 0) return;
    setSceneModeResults([]);
    setMyLines(weakLines);
    myLinesRef.current = weakLines;
    const testModes: Record<string, 'practice' | 'test'> = {};
    weakLines.forEach(l => { testModes[l.id] = 'test'; });
    setLineModes(testModes);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setFeedback(null);
    setTranscript('');
    setHintText('');
    setHintLevel(0);
    setShowLine(false);
    setCoachingQuestion('');
    setPracticeStateAndRef('cue');
  };

  const flipToTest = () => {
    if (!currentLine) return;
    const newModes = { ...lineModes, [currentLine.id]: 'test' as const };
    setLineModes(newModes);
    updateLineProgress(currentLine.id, { readyForTest: true });
    setPracticeStateAndRef('cue');
  };

  const flipToPractice = () => {
    if (!currentLine) return;
    const newModes = { ...lineModes, [currentLine.id]: 'practice' as const };
    setLineModes(newModes);
    updateLineProgress(currentLine.id, { readyForTest: false });
    setPracticeStateAndRef('practice_idle');
  };

  const handleNext = () => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setAutoAdvancing(false);
    const nextIndex = currentIndex + 1;
    if (nextIndex >= myLines.length) {
      setPracticeStateAndRef('complete');
    } else {
      setCurrentIndex(nextIndex);
      currentIndexRef.current = nextIndex;
      setFeedback(null);
      setTranscript('');
      setHintText('');
      setHintLevel(0);
      setShowLine(false);
      setCoachingQuestion('');
      const nextLineId = myLines[nextIndex].id;
      const nextMode = sceneConfig ? 'test' : (lineModes[nextLineId] ?? 'practice');
      setPracticeStateAndRef(nextMode === 'test' ? 'cue' : 'practice_idle');
    }
  };

  const handleHint = () => {
    if (!currentLine) return;
    const nextLevel = Math.min(3, hintLevel + 1) as 1 | 2 | 3;
    setHintLevel(nextLevel);
    const words = currentLine.text.split(' ');
    if (nextLevel === 1) {
      setHintText(words.slice(0, 3).join(' ') + '...');
    } else if (nextLevel === 2) {
      setHintText(words.slice(0, Math.ceil(words.length / 2)).join(' ') + '...');
    } else {
      setHintText(currentLine.text);
    }
  };

  const handleCallForLine = () => {
    if (!currentLine) return;
    const words = currentLine.text.split(' ');
    setHintText(words.slice(0, 3).join(' ') + '...');
    setHintLevel(1);
    if (practiceStateRef.current === 'listening') {
      calledForLineRef.current = true;
      stopListening();
    }
  };

  const handleSpeakCue = (text: string) => {
    Speech.speak(text, { language: 'en-US', rate: 0.9 });
  };

  const handleCoachingQuestion = async () => {
    if (!currentLine || !scene) return;
    try {
      let q: string;
      if (settings?.anthropicApiKey) {
        q = await getCoachingQuestion(
          settings.anthropicApiKey,
          script?.selectedCharacter ?? '',
          currentLine.text,
          scene.title
        );
      } else if (script?.scriptToken) {
        q = await getCoachingViaBackend(
          script.scriptToken,
          script?.selectedCharacter ?? '',
          currentLine.text,
          scene.title
        );
      } else {
        q = 'What does your character want in this moment?';
      }
      setCoachingQuestion(q);
    } catch {
      setCoachingQuestion('What does your character want in this moment?');
    }
  };

  const handleEditLine = () => {
    if (!currentLine || !script) return;
    Alert.prompt(
      'Edit Line',
      'Fix any transcription errors:',
      (newText) => {
        if (!newText?.trim() || newText.trim() === currentLine.text) return;
        const updatedScenes = script.scenes.map(sc => ({
          ...sc,
          lines: sc.lines.map(l => l.id === currentLine.id ? { ...l, text: newText.trim() } : l),
        }));
        const updatedScript = { ...script, scenes: updatedScenes };
        setScript(updatedScript);
        saveScript(updatedScript);
        setMyLines(prev => prev.map(l => l.id === currentLine.id ? { ...l, text: newText.trim() } : l));
      },
      'plain-text',
      currentLine.text,
    );
  };

  const handleViewPdf = () => {
    if (script?.pdfUri) Linking.openURL(script.pdfUri);
  };

  const renderCues = () => {
    if (!currentLine) return null;
    const cues = currentLine.cues.slice(-(settings?.cueContext ?? 1));
    if (cues.length === 0) {
      return (
        <View style={styles.cueContainer}>
          <Text style={styles.cueLabel}>Opening line</Text>
          <Text style={styles.cueEmpty}>Your character speaks first in this section.</Text>
        </View>
      );
    }
    return (
      <View style={styles.cueContainer}>
        <Text style={styles.cueLabel}>Your cue</Text>
        {cues.map((cue, i) => (
          <View key={i} style={styles.cueRow}>
            <TouchableOpacity
              onPress={() => handleSpeakCue(cue.text)}
              style={styles.cueSpeakBtn}
            >
              <Ionicons name="volume-high-outline" size={14} color={Colors.accent} />
            </TouchableOpacity>
            <View style={styles.cueTextBlock}>
              <Text style={styles.cueCharacter}>{cue.character}</Text>
              <Text style={styles.cueText}>{cue.text}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  if (!script || !scene || myLines.length === 0) return null;

  const progressPercent = currentIndex / myLines.length;

  // SCENE MODE REVIEW SCREEN
  if (practiceState === 'complete' && sceneConfig) {
    const avgScore = sceneModeResults.length > 0
      ? Math.round(sceneModeResults.reduce((sum, r) => sum + r.score, 0) / sceneModeResults.length)
      : 0;
    const aboveThreshold = sceneModeResults.filter(r => r.score >= sceneConfig.threshold).length;
    const hasWeakLines = sceneModeResults.some(r => r.score < sceneConfig.threshold);
    const weakCount = sceneModeResults.filter(r => r.score < sceneConfig.threshold).length;

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.reviewScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.reviewTitle}>Scene Review</Text>
          <Text style={styles.reviewSub}>{scene.title}</Text>

          <View style={styles.reviewStatsRow}>
            <View style={styles.reviewStat}>
              <Text style={[
                styles.reviewStatNum,
                { color: avgScore >= 90 ? Colors.success : avgScore >= 60 ? Colors.warning : Colors.error }
              ]}>
                {avgScore}%
              </Text>
              <Text style={styles.reviewStatLabel}>avg score</Text>
            </View>
            <View style={styles.reviewStat}>
              <Text style={styles.reviewStatNum}>{aboveThreshold}/{sceneModeResults.length}</Text>
              <Text style={styles.reviewStatLabel}>above {sceneConfig.threshold}%</Text>
            </View>
          </View>

          <View style={styles.reviewLineList}>
            {sceneModeResults.map((r, i) => (
              <View key={r.lineId + i} style={styles.reviewLineRow}>
                <View style={[
                  styles.reviewScoreBadge,
                  {
                    backgroundColor:
                      r.score >= 90 ? Colors.success
                      : r.score >= 60 ? Colors.warning
                      : Colors.error,
                  },
                ]}>
                  <Text style={styles.reviewScoreBadgeText}>{r.score}</Text>
                </View>
                <Text style={styles.reviewLineText} numberOfLines={2}>{r.lineText}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.reviewButtons}>
          {hasWeakLines && (
            <Button
              label={`Practice Weak Lines (${weakCount})`}
              variant="secondary"
              onPress={handlePracticeWeakLines}
            />
          )}
          <Button label="Run Again" variant="secondary" onPress={handleRunSceneAgain} />
          <Button label="Back to Script" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  // NORMAL COMPLETE STATE
  if (practiceState === 'complete') {
    const masteredCount = myLines.filter((l) => {
      const sp = progress?.sceneProgress[sceneId];
      return sp?.lineProgress[l.id]?.mastered;
    }).length;

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.completeContainer}>
          <Text style={styles.completeEmoji}>✓</Text>
          <Text style={styles.completeTitle}>Scene Complete</Text>
          <Text style={styles.completeSub}>{scene.title}</Text>
          <View style={styles.completeStat}>
            <Text style={styles.completeStatNum}>{masteredCount}</Text>
            <Text style={styles.completeStatLabel}>lines mastered</Text>
          </View>
          <View style={styles.completeButtons}>
            <Button
              label="Practice Again"
              variant="secondary"
              onPress={() => {
                setCurrentIndex(0);
                setFeedback(null);
                const firstMode = lineModes[myLines[0]?.id] ?? 'practice';
                setPracticeStateAndRef(firstMode === 'test' ? 'cue' : 'practice_idle');
              }}
            />
            <Button label="Back to Script" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Scene Config Modal */}
      <Modal
        visible={showSceneConfig}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSceneConfig(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSceneConfig(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Scene Mode</Text>
            <TouchableOpacity onPress={handleStartSceneMode}>
              <Text style={styles.modalStart}>Start</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <Text style={styles.configSectionLabel}>Style</Text>
            <View style={styles.configCards}>
              <TouchableOpacity
                style={[styles.configCard, configType === 'flow' && styles.configCardActive]}
                onPress={() => setConfigType('flow')}
              >
                <Ionicons
                  name="play-circle-outline"
                  size={28}
                  color={configType === 'flow' ? Colors.accent : Colors.textMuted}
                />
                <Text style={[styles.configCardTitle, configType === 'flow' && styles.configCardTitleActive]}>
                  Flow
                </Text>
                <Text style={styles.configCardDesc}>
                  Keep moving. Review scores at the end.
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.configCard, configType === 'drill' && styles.configCardActive]}
                onPress={() => setConfigType('drill')}
              >
                <Ionicons
                  name="refresh-circle-outline"
                  size={28}
                  color={configType === 'drill' ? Colors.accent : Colors.textMuted}
                />
                <Text style={[styles.configCardTitle, configType === 'drill' && styles.configCardTitleActive]}>
                  Drill
                </Text>
                <Text style={styles.configCardDesc}>
                  Pause on missed lines. Repeat until you nail it.
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.configSectionLabel}>Pass threshold</Text>
            <View style={styles.segmentRow}>
              {[70, 80, 90].map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.segmentBtn, configThreshold === t && styles.segmentBtnActive]}
                  onPress={() => setConfigThreshold(t)}
                >
                  <Text style={[styles.segmentBtnText, configThreshold === t && styles.segmentBtnTextActive]}>
                    {t}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.configSectionLabel}>Lines per run</Text>
            <View style={styles.segmentRow}>
              {([5, 10, 20, null] as (number | null)[]).map(n => (
                <TouchableOpacity
                  key={String(n)}
                  style={[styles.segmentBtn, configLineCount === n && styles.segmentBtnActive]}
                  onPress={() => setConfigLineCount(n)}
                >
                  <Text style={[styles.segmentBtnText, configLineCount === n && styles.segmentBtnTextActive]}>
                    {n === null ? 'All' : String(n)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.configNote}>
              {allMyLinesRef.current.length} lines in this scene for {script?.selectedCharacter}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerScene} numberOfLines={1}>
              {scene.title}
            </Text>
            {sceneConfig && (
              <View style={styles.sceneBadge}>
                <Text style={styles.sceneBadgeText}>
                  {sceneConfig.type === 'flow' ? 'Flow' : 'Drill'}
                </Text>
              </View>
            )}
            {script.pdfUri ? (
              <TouchableOpacity onPress={handleViewPdf} style={styles.pdfLink}>
                <Text style={styles.pdfLinkText}>PDF</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.headerProgress}>
            {currentIndex + 1} of {myLines.length}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowSceneConfig(true)}
          style={styles.sceneBtn}
        >
          <Ionicons
            name="film-outline"
            size={22}
            color={sceneConfig ? Colors.accent : Colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      <ProgressBar progress={progressPercent} style={styles.topProgress} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Cue */}
        {renderCues()}

        {/* Your line section */}
        <View style={styles.yourTurn}>
          <Text style={styles.yourTurnLabel}>{script.selectedCharacter}</Text>

          {/* PRACTICE MODE: idle */}
          {practiceState === 'practice_idle' && (
            <>
              <View style={styles.practiceLineCard}>
                <Text style={styles.practiceLineText}>{currentLine?.text}</Text>
                <TouchableOpacity onPress={handleEditLine} style={styles.editBtn}>
                  <Ionicons name="pencil-outline" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              {transcript ? (
                <Card style={styles.practiceTranscriptCard}>
                  <Text style={styles.practiceTranscriptLabel}>You said</Text>
                  <Text style={styles.practiceTranscriptText}>{transcript}</Text>
                </Card>
              ) : (
                <Text style={styles.yourTurnPrompt}>Read it through, then tap the mic to speak it</Text>
              )}
              {coachingQuestion ? (
                <Card style={styles.coachCard}>
                  <Ionicons name="help-circle-outline" size={16} color={Colors.accent} />
                  <Text style={styles.coachQuestion}>{coachingQuestion}</Text>
                </Card>
              ) : null}
            </>
          )}

          {/* PRACTICE MODE: speaking */}
          {practiceState === 'practice_speaking' && (
            <>
              <View style={styles.practiceLineCard}>
                <Text style={styles.practiceLineText}>{currentLine?.text}</Text>
                <TouchableOpacity onPress={handleEditLine} style={styles.editBtn}>
                  <Ionicons name="pencil-outline" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.listeningBox}>
                {transcript ? (
                  <Text style={styles.transcriptText}>{transcript}</Text>
                ) : (
                  <Text style={styles.listeningPrompt}>Listening...</Text>
                )}
              </View>
            </>
          )}

          {/* TEST MODE: cue */}
          {practiceState === 'cue' && (
            <>
              {hintText ? (
                <Card style={styles.hintCard}>
                  <Text style={styles.hintLabel}>
                    {hintLevel === 1 ? 'First few words' : hintLevel === 2 ? 'First half' : 'Full line'}
                  </Text>
                  <Text style={styles.hintText}>{hintText}</Text>
                </Card>
              ) : (
                <Text style={styles.yourTurnPrompt}>Your turn — when you're ready, tap to speak</Text>
              )}
              {coachingQuestion ? (
                <Card style={styles.coachCard}>
                  <Ionicons name="help-circle-outline" size={16} color={Colors.accent} />
                  <Text style={styles.coachQuestion}>{coachingQuestion}</Text>
                </Card>
              ) : null}
            </>
          )}

          {/* TEST MODE: listening */}
          {practiceState === 'listening' && (
            <View style={styles.listeningBox}>
              {transcript ? (
                <Text style={styles.transcriptText}>{transcript}</Text>
              ) : (
                <Text style={styles.listeningPrompt}>Listening...</Text>
              )}
            </View>
          )}

          {practiceState === 'evaluating' && (
            <View style={styles.evaluatingBox}>
              <Text style={styles.evaluatingText}>Checking your line...</Text>
            </View>
          )}

          {practiceState === 'feedback' && feedback && (
            <View style={styles.feedbackContainer}>
              <View
                style={[
                  styles.scoreBar,
                  {
                    backgroundColor:
                      feedback.score >= 90
                        ? Colors.success
                        : feedback.score >= 60
                        ? Colors.warning
                        : Colors.error,
                  },
                ]}
              >
                <Text style={styles.scoreText}>
                  {feedback.score >= 90 ? 'Great!' : feedback.score >= 60 ? 'Close' : 'Not quite'}
                </Text>
                <Text style={styles.scoreNum}>{feedback.score}%</Text>
              </View>

              {autoAdvancing && (
                <Text style={styles.autoAdvanceText}>Moving on...</Text>
              )}

              <Card style={styles.attemptCard}>
                <Text style={styles.attemptLabel}>You said</Text>
                <Text style={styles.attemptText}>{transcript}</Text>
              </Card>

              <Text style={styles.feedbackText}>{feedback.feedback}</Text>

              {feedback.corrections && (
                <Card style={styles.correctionCard}>
                  <Text style={styles.correctionLabel}>Correction</Text>
                  <Text style={styles.correctionText}>{feedback.corrections}</Text>
                </Card>
              )}

              {showLine || feedback.score < 60 ? (
                <Card style={styles.actualLineCard}>
                  <Text style={styles.actualLineLabel}>The line</Text>
                  <Text style={styles.actualLineText}>{currentLine?.text}</Text>
                  <TouchableOpacity
                    onPress={() => handleSpeakCue(currentLine?.text ?? '')}
                    style={styles.speakLineBtn}
                  >
                    <Ionicons name="volume-high-outline" size={16} color={Colors.accent} />
                    <Text style={styles.speakLineBtnText}>Hear it spoken</Text>
                  </TouchableOpacity>
                </Card>
              ) : (
                <TouchableOpacity onPress={() => setShowLine(true)}>
                  <Text style={styles.showLineLink}>Show correct line</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom controls */}
      <View style={styles.controls}>
        {/* PRACTICE IDLE controls */}
        {practiceState === 'practice_idle' && (
          <View style={styles.cueControls}>
            <TouchableOpacity onPress={handleCoachingQuestion} style={styles.coachBtn}>
              <Ionicons name="help-circle-outline" size={20} color={Colors.accent} />
              <Text style={styles.coachBtnText}>Why?</Text>
            </TouchableOpacity>

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={styles.speakBtn}
                onPress={() => startListening('practice')}
                activeOpacity={0.8}
              >
                <Ionicons name="mic" size={28} color={Colors.white} />
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity onPress={flipToTest} style={styles.testFlipBtn}>
              <Text style={styles.testFlipText}>Test this</Text>
              <Text style={styles.testFlipText}>line →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* PRACTICE SPEAKING: stop button */}
        {practiceState === 'practice_speaking' && (
          <TouchableOpacity style={styles.stopBtn} onPress={stopListening} activeOpacity={0.8}>
            <Ionicons name="stop" size={28} color={Colors.white} />
          </TouchableOpacity>
        )}

        {/* TEST CUE controls */}
        {practiceState === 'cue' && (
          <View style={styles.cueControls}>
            {sceneConfig ? (
              <View style={{ width: 60 }} />
            ) : (
              <TouchableOpacity onPress={flipToPractice} style={styles.practiceFlipBtn}>
                <Text style={styles.practiceFlipText}>← Practice</Text>
              </TouchableOpacity>
            )}

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={styles.speakBtn}
                onPress={() => startListening('test')}
                activeOpacity={0.8}
              >
                <Ionicons name="mic" size={28} color={Colors.white} />
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              onPress={hintLevel === 0 ? handleCallForLine : handleHint}
              style={[styles.callLineBtn, hintLevel >= 3 && styles.callLineBtnDim]}
              disabled={hintLevel >= 3}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={Colors.white} />
              <Text style={styles.callLineBtnText}>
                {hintLevel === 0 ? 'Line' : hintLevel === 1 ? 'More' : hintLevel === 2 ? 'Full' : 'Shown'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* TEST LISTENING: stop + call for line */}
        {practiceState === 'listening' && (
          <View style={styles.listeningControls}>
            <TouchableOpacity onPress={handleCallForLine} style={styles.callLineBtn}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={Colors.white} />
              <Text style={styles.callLineBtnText}>Line</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stopBtn} onPress={stopListening} activeOpacity={0.8}>
              <Ionicons name="stop" size={28} color={Colors.white} />
            </TouchableOpacity>
          </View>
        )}

        {/* FEEDBACK controls */}
        {practiceState === 'feedback' && (
          <View style={styles.feedbackControls}>
            {sceneConfig?.type === 'flow' ? (
              // Flow mode: single Next Line button (tap to advance early)
              <Button label="Next Line" onPress={handleNext} />
            ) : sceneConfig?.type === 'drill' && feedback && feedback.score < sceneConfig.threshold ? (
              // Drill mode, below threshold: Try Again + Skip
              <>
                <Button
                  label="Try Again"
                  variant="secondary"
                  onPress={() => {
                    setFeedback(null);
                    setTranscript('');
                    setShowLine(false);
                    setPracticeStateAndRef('cue');
                  }}
                />
                <Button label="Skip" onPress={handleNext} />
              </>
            ) : sceneConfig ? (
              // Drill mode, above threshold: Next Line (auto-advancing)
              <Button label="Next Line" onPress={handleNext} />
            ) : (
              // Normal mode: Try Again + Next Line
              <>
                <Button
                  label="Try Again"
                  variant="secondary"
                  onPress={() => {
                    setFeedback(null);
                    setTranscript('');
                    setShowLine(false);
                    setPracticeStateAndRef(currentMode === 'test' ? 'cue' : 'practice_idle');
                  }}
                />
                <Button label="Next Line" onPress={handleNext} />
              </>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  headerScene: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  sceneBadge: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sceneBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.white,
    fontWeight: '700',
  },
  pdfLink: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pdfLinkText: {
    fontSize: FontSize.xs,
    color: Colors.accent,
    fontWeight: '600',
  },
  headerProgress: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 1,
  },
  sceneBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topProgress: {
    marginHorizontal: 0,
    borderRadius: 0,
    height: 3,
  },
  scroll: {
    padding: Spacing.lg,
    paddingBottom: 120,
    gap: Spacing.lg,
  },
  cueContainer: {
    gap: Spacing.sm,
  },
  cueLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cueEmpty: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  cueRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  cueSpeakBtn: {
    marginTop: 18,
    padding: 4,
  },
  cueTextBlock: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.border,
  },
  cueCharacter: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  cueText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  yourTurn: {
    gap: Spacing.md,
  },
  yourTurnLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  yourTurnPrompt: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  practiceLineCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
    position: 'relative',
  },
  practiceLineText: {
    fontSize: FontSize.lg,
    color: Colors.text,
    lineHeight: 26,
    paddingRight: 28,
  },
  editBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    padding: 4,
  },
  practiceTranscriptCard: {
    gap: 4,
  },
  practiceTranscriptLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  practiceTranscriptText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  hintCard: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
    gap: 4,
  },
  hintLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hintText: {
    fontSize: FontSize.lg,
    color: Colors.text,
    lineHeight: 24,
  },
  coachCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
  },
  coachQuestion: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.text,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  listeningBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 2,
    borderColor: Colors.accent,
    minHeight: 70,
    justifyContent: 'center',
  },
  listeningPrompt: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  transcriptText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  evaluatingBox: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  evaluatingText: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  feedbackContainer: {
    gap: Spacing.md,
  },
  scoreBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  scoreText: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.white,
  },
  scoreNum: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.white,
    opacity: 0.85,
  },
  autoAdvanceText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: -Spacing.sm,
  },
  attemptCard: {
    gap: 4,
  },
  attemptLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  attemptText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  feedbackText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  correctionCard: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
    gap: 4,
  },
  correctionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.error,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  correctionText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  actualLineCard: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
    gap: Spacing.sm,
  },
  actualLineLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.success,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actualLineText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  speakLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  speakLineBtnText: {
    fontSize: FontSize.sm,
    color: Colors.accent,
  },
  showLineLink: {
    fontSize: FontSize.sm,
    color: Colors.accent,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  cueControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  speakBtn: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accentDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  stopBtn: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    shadowColor: Colors.error,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  callLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  callLineBtnDim: {
    backgroundColor: Colors.border,
  },
  callLineBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.white,
  },
  listeningControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  coachBtn: {
    alignItems: 'center',
    gap: 4,
    width: 60,
  },
  coachBtnText: {
    fontSize: FontSize.xs,
    color: Colors.accent,
    fontWeight: '600',
  },
  testFlipBtn: {
    alignItems: 'center',
    width: 60,
  },
  testFlipText: {
    fontSize: FontSize.xs,
    color: Colors.accent,
    fontWeight: '600',
    lineHeight: 16,
  },
  practiceFlipBtn: {
    width: 60,
    alignItems: 'center',
  },
  practiceFlipText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  feedbackControls: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  completeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  completeEmoji: {
    fontSize: 56,
    color: Colors.success,
    fontWeight: '700',
  },
  completeTitle: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.text,
  },
  completeSub: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
  },
  completeStat: {
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  completeStatNum: {
    fontSize: 48,
    fontWeight: '700',
    color: Colors.accent,
  },
  completeStatLabel: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
  },
  completeButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  // Scene mode modal
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  modalCancel: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
  },
  modalStart: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.accent,
  },
  modalScroll: {
    flex: 1,
  },
  modalContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  configSectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.sm,
  },
  configCards: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  configCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  configCardActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.background,
  },
  configCardTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  configCardTitleActive: {
    color: Colors.accent,
  },
  configCardDesc: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  segmentBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  segmentBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  segmentBtnTextActive: {
    color: Colors.white,
  },
  configNote: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  // Scene mode review screen
  reviewScroll: {
    padding: Spacing.lg,
    paddingBottom: 160,
    gap: Spacing.lg,
  },
  reviewTitle: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  reviewSub: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: -Spacing.sm,
  },
  reviewStatsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xl,
    marginVertical: Spacing.md,
  },
  reviewStat: {
    alignItems: 'center',
    gap: 2,
  },
  reviewStatNum: {
    fontSize: 40,
    fontWeight: '700',
    color: Colors.text,
  },
  reviewStatLabel: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  reviewLineList: {
    gap: Spacing.sm,
  },
  reviewLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  reviewScoreBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  reviewScoreBadgeText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.white,
  },
  reviewLineText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  reviewButtons: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
});
