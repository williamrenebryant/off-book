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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getScript, getProgress, saveProgress, initProgress, getSettings } from '@/lib/storage';
import { evaluateLine, getHint, getCoachingQuestion } from '@/lib/claude';
import { Script, Scene, Line, ScriptProgress, FeedbackResult, AppSettings } from '@/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';

type PracticeState = 'cue' | 'listening' | 'evaluating' | 'feedback' | 'complete';

export default function PracticeScreen() {
  const { id, sceneId } = useLocalSearchParams<{ id: string; sceneId: string }>();
  const router = useRouter();

  const [script, setScript] = useState<Script | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [myLines, setMyLines] = useState<Line[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [practiceState, setPracticeState] = useState<PracticeState>('cue');
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState<FeedbackResult | null>(null);
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [hintText, setHintText] = useState('');
  const [progress, setProgress] = useState<ScriptProgress | null>(null);
  const [coachingQuestion, setCoachingQuestion] = useState('');
  const [showLine, setShowLine] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setTranscript(text);
  });

  useSpeechRecognitionEvent('end', () => {
    if (practiceState === 'listening' && transcript) {
      handleEvaluate(transcript);
    } else if (practiceState === 'listening') {
      setPracticeState('cue');
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

        setProgress(p ?? initProgress(s.id, s.selectedCharacter ?? ''));
      }
    );
  }, [id, sceneId]);

  useEffect(() => {
    return () => {
      Speech.stop();
      ExpoSpeechRecognitionModule.stop();
    };
  }, []);

  const currentLine = myLines[currentIndex];

  const startListening = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Microphone Required',
        'Please allow microphone access in Settings to practice your lines.'
      );
      return;
    }

    setTranscript('');
    setPracticeState('listening');
    startPulse();

    ExpoSpeechRecognitionModule.start({
      lang: settings?.speechLanguage ?? 'en-US',
      interimResults: true,
      maxAlternatives: 1,
    });
  };

  const stopListening = () => {
    stopPulse();
    ExpoSpeechRecognitionModule.stop();
    if (transcript) {
      handleEvaluate(transcript);
    } else {
      setPracticeState('cue');
    }
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

  const handleEvaluate = async (spokenText: string) => {
    if (!currentLine || !settings?.anthropicApiKey) return;
    stopPulse();
    setPracticeState('evaluating');

    try {
      const context = scene?.title ?? '';
      const result = await evaluateLine(
        settings.anthropicApiKey,
        spokenText,
        currentLine.text,
        script?.selectedCharacter ?? '',
        context
      );
      setFeedback(result);
      setHintText('');
      setHintLevel(0);
      setShowLine(false);
      setPracticeState('feedback');
      updateProgress(result);
    } catch (err: any) {
      Alert.alert('Error', err.message);
      setPracticeState('cue');
    }
  };

  const updateProgress = (result: FeedbackResult) => {
    if (!progress || !currentLine) return;
    const sceneProgress = progress.sceneProgress[sceneId] ?? {
      sceneId,
      lineProgress: {},
    };
    const existing = sceneProgress.lineProgress[currentLine.id] ?? {
      lineId: currentLine.id,
      attempts: 0,
      correctAttempts: 0,
      lastPracticed: '',
      mastered: false,
    };

    const updated = {
      ...existing,
      attempts: existing.attempts + 1,
      correctAttempts: existing.correctAttempts + (result.score >= 90 ? 1 : 0),
      lastPracticed: new Date().toISOString(),
      mastered: existing.correctAttempts + (result.score >= 90 ? 1 : 0) >= 3,
    };

    const newProgress: ScriptProgress = {
      ...progress,
      lastPracticed: new Date().toISOString(),
      sceneProgress: {
        ...progress.sceneProgress,
        [sceneId]: {
          ...sceneProgress,
          lineProgress: {
            ...sceneProgress.lineProgress,
            [currentLine.id]: updated,
          },
        },
      },
    };
    setProgress(newProgress);
    saveProgress(newProgress);
  };

  const handleNext = () => {
    if (currentIndex + 1 >= myLines.length) {
      setPracticeState('complete');
    } else {
      setCurrentIndex((i) => i + 1);
      setFeedback(null);
      setTranscript('');
      setHintText('');
      setHintLevel(0);
      setShowLine(false);
      setCoachingQuestion('');
      setPracticeState('cue');
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
                setPracticeState('cue');
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
          <Text style={styles.headerScene} numberOfLines={1}>
            {scene.title}
          </Text>
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
              {/* Score indicator */}
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

              {/* What you said */}
              <Card style={styles.attemptCard}>
                <Text style={styles.attemptLabel}>You said</Text>
                <Text style={styles.attemptText}>{transcript}</Text>
              </Card>

              {/* Feedback text */}
              <Text style={styles.feedbackText}>{feedback.feedback}</Text>

              {/* Corrections */}
              {feedback.corrections && (
                <Card style={styles.correctionCard}>
                  <Text style={styles.correctionLabel}>Correction</Text>
                  <Text style={styles.correctionText}>{feedback.corrections}</Text>
                </Card>
              )}

              {/* Actual line (toggle) */}
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
        {practiceState === 'cue' && (
          <View style={styles.cueControls}>
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

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity style={styles.speakBtn} onPress={startListening} activeOpacity={0.8}>
                <Ionicons name="mic" size={28} color={Colors.white} />
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity onPress={handleCoachingQuestion} style={styles.coachBtn}>
              <Ionicons name="help-circle-outline" size={20} color={Colors.accent} />
              <Text style={styles.coachBtnText}>Why?</Text>
            </TouchableOpacity>
          </View>
        )}

        {practiceState === 'listening' && (
          <TouchableOpacity style={styles.stopBtn} onPress={stopListening} activeOpacity={0.8}>
            <Ionicons name="stop" size={28} color={Colors.white} />
          </TouchableOpacity>
        )}

        {practiceState === 'feedback' && (
          <View style={styles.feedbackControls}>
            <Button
              label="Try Again"
              variant="secondary"
              onPress={() => {
                setFeedback(null);
                setTranscript('');
                setShowLine(false);
                setPracticeState('cue');
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
  headerScene: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
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
