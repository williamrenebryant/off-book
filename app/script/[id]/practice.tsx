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
import { Script, Scene, Line, ScriptProgress, LineProgress, FeedbackResult, AppSettings } from '@/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';

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

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  // Avoid stale closures in speech event handlers
  const practiceStateRef = useRef<PracticeState>('practice_idle');
  const currentLineRef = useRef<Line | null>(null);

  // Transcript tracking
  const interimTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const hasFinalRef = useRef(false);

  // Timing
  const listeningStartRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPracticeStateAndRef = (s: PracticeState) => {
    practiceStateRef.current = s;
    setPracticeState(s);
  };

  useEffect(() => {
    currentLineRef.current = myLines[currentIndex] ?? null;
  }, [myLines, currentIndex]);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setTranscript(text);
    interimTranscriptRef.current = text;
    if (event.isFinal) {
      hasFinalRef.current = true;
      finalTranscriptRef.current = text;
    }
  });

  useSpeechRecognitionEvent('end', () => {
    const state = practiceStateRef.current;
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    stopPulse();

    if (state === 'practice_speaking') {
      if (listeningStartRef.current) {
        const dur = Date.now() - listeningStartRef.current;
        listeningStartRef.current = null;
        updateLineProgress(currentLineRef.current!.id, { practiceDuration: dur });
      }
      setPracticeStateAndRef('practice_idle');
    } else if (state === 'listening') {
      const best = hasFinalRef.current ? finalTranscriptRef.current : interimTranscriptRef.current;
      if (best) {
        handleEvaluate(best);
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
    startPulse();

    if (mode === 'practice') {
      listeningStartRef.current = Date.now();
      setPracticeStateAndRef('practice_speaking');
    } else {
      setPracticeStateAndRef('listening');
      const pd = progress?.sceneProgress[sceneId]?.lineProgress[currentLine?.id ?? '']?.practiceDuration;
      if (pd) {
        autoStopTimerRef.current = setTimeout(() => {
          ExpoSpeechRecognitionModule.stop();
        }, pd * 1.5 + 3000);
      }
    }

    ExpoSpeechRecognitionModule.start({
      lang: settings?.speechLanguage ?? 'en-US',
      interimResults: true,
      maxAlternatives: 1,
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

  const handleEvaluate = async (spokenText: string) => {
    if (!currentLineRef.current || !settings?.anthropicApiKey) return;
    stopPulse();
    setPracticeStateAndRef('evaluating');

    try {
      const context = scene?.title ?? '';
      const result = await evaluateLine(
        settings.anthropicApiKey,
        spokenText,
        currentLineRef.current.text,
        script?.selectedCharacter ?? '',
        context
      );
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
    } catch (err: any) {
      Alert.alert('Error', err.message);
      setPracticeStateAndRef('cue');
    }
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
    const nextIndex = currentIndex + 1;
    if (nextIndex >= myLines.length) {
      setPracticeStateAndRef('complete');
    } else {
      setCurrentIndex(nextIndex);
      setFeedback(null);
      setTranscript('');
      setHintText('');
      setHintLevel(0);
      setShowLine(false);
      setCoachingQuestion('');
      const nextLineId = myLines[nextIndex].id;
      const nextMode = lineModes[nextLineId] ?? 'practice';
      setPracticeStateAndRef(nextMode === 'test' ? 'cue' : 'practice_idle');
    }
  };

  const handleHint = async () => {
    if (!currentLine || !settings?.anthropicApiKey) return;
    const nextLevel = Math.min(3, hintLevel + 1) as 1 | 2 | 3;
    setHintLevel(nextLevel);
    try {
      const hint = await getHint(settings.anthropicApiKey, currentLine.text, transcript, nextLevel);
      setHintText(hint);
    } catch {
      setHintText(currentLine.text.split(' ').slice(0, 3).join(' ') + '...');
    }
  };

  const handleSpeakCue = (text: string) => {
    Speech.speak(text, { language: 'en-US', rate: 0.9 });
  };

  const handleCoachingQuestion = async () => {
    if (!currentLine || !settings?.anthropicApiKey || !scene) return;
    try {
      const q = await getCoachingQuestion(
        settings.anthropicApiKey,
        script?.selectedCharacter ?? '',
        currentLine.text,
        scene.title
      );
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

  // COMPLETE STATE
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
        <View style={{ width: 40 }} />
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

          {(practiceState === 'evaluating') && (
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
            <TouchableOpacity onPress={flipToPractice} style={styles.practiceFlipBtn}>
              <Text style={styles.practiceFlipText}>← Practice</Text>
            </TouchableOpacity>

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={styles.speakBtn}
                onPress={() => startListening('test')}
                activeOpacity={0.8}
              >
                <Ionicons name="mic" size={28} color={Colors.white} />
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity onPress={handleHint} style={styles.hintBtn} disabled={hintLevel >= 3}>
              <Ionicons
                name="bulb-outline"
                size={20}
                color={hintLevel >= 3 ? Colors.textLight : Colors.accent}
              />
              <Text
                style={[styles.hintBtnText, hintLevel >= 3 && { color: Colors.textLight }]}
              >
                {hintLevel === 0 ? 'Hint' : hintLevel === 1 ? 'More' : hintLevel === 2 ? 'Full line' : 'Shown'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* TEST LISTENING: stop button */}
        {practiceState === 'listening' && (
          <TouchableOpacity style={styles.stopBtn} onPress={stopListening} activeOpacity={0.8}>
            <Ionicons name="stop" size={28} color={Colors.white} />
          </TouchableOpacity>
        )}

        {/* FEEDBACK controls */}
        {practiceState === 'feedback' && (
          <View style={styles.feedbackControls}>
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
  hintBtn: {
    alignItems: 'center',
    gap: 4,
    width: 60,
  },
  hintBtnText: {
    fontSize: FontSize.xs,
    color: Colors.accent,
    fontWeight: '600',
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
});
