import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import {
  startRecording,
  stopRecording,
  playAudio,
  stopAudio,
  checkStorageLimit,
} from '@/lib/audio';
import { getSettings, saveScript, getScripts, saveSettings } from '@/lib/storage';
import { Script, Line, Scene, LineType } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

type Step = 'title' | 'setup' | 'record' | 'review' | 'save';

interface RecordedLine {
  id: string;
  character: string;
  text: string;
  audioUri: string;
  durationMs: number;
}

export default function RecordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scriptTitle?: string }>();

  // Step state
  const [step, setStep] = useState<Step>(params.scriptTitle ? 'setup' : 'title');

  // Title step
  const [scriptTitle, setScriptTitle] = useState(params.scriptTitle ?? '');

  // Setup step
  const [sceneTitle, setSceneTitle] = useState('');
  const [characters, setCharacters] = useState<string[]>([]);
  const [characterInput, setCharacterInput] = useState('');

  // Record step
  const [recordedLines, setRecordedLines] = useState<RecordedLine[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [currentRecording, setCurrentRecording] = useState<Audio.Recording | null>(null);
  const [transcript, setTranscript] = useState('');

  // Review step
  const [editedLines, setEditedLines] = useState<RecordedLine[]>([]);

  // Save step
  const [addToExisting, setAddToExisting] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [existingScripts, setExistingScripts] = useState<Script[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Refs for speech recognition
  const isRecordingRef = useRef(false);
  const currentCharacterRef = useRef<string | null>(null);
  const transcriptRef = useRef('');

  // Load existing scripts for save step
  useEffect(() => {
    if (step === 'save') {
      getScripts().then(setExistingScripts);
    }
  }, [step]);

  // Speech recognition handlers
  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    transcriptRef.current = text;
    setTranscript(text);
  });

  useSpeechRecognitionEvent('end', () => {
    // Do nothing; user will manually stop recording
  });

  // Handle adding character
  const handleAddCharacter = () => {
    if (!characterInput.trim()) return;
    const char = characterInput.trim();
    if (!characters.includes(char)) {
      setCharacters([...characters, char]);
    }
    setCharacterInput('');
  };

  // Handle removing character
  const handleRemoveCharacter = (char: string) => {
    setCharacters(characters.filter((c) => c !== char));
    if (activeCharacter === char) {
      setActiveCharacter(null);
    }
  };

  // Start recording for a character
  const handleStartRecording = async (char: string) => {
    if (activeCharacter === char) {
      // Stop recording
      await handleStopRecording();
    } else {
      // Stop previous recording if any
      if (activeCharacter) {
        await handleStopRecording();
      }

      // Check storage limit
      const storageStatus = await checkStorageLimit();
      if (storageStatus.overLimit) {
        Alert.alert(
          'Storage Limit Reached',
          'You have reached the 500MB audio limit. Delete some recordings in Settings > Audio Storage to continue.'
        );
        return;
      }

      // Start STT
      const perms = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perms.granted) {
        Alert.alert(
          'Microphone Required',
          'Please allow microphone access to record lines.'
        );
        return;
      }

      try {
        // Start recording
        const recording = await startRecording();
        setCurrentRecording(recording);
        setActiveCharacter(char);
        currentCharacterRef.current = char;
        setTranscript('');
        transcriptRef.current = '';
        isRecordingRef.current = true;

        // Start STT
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          maxAlternatives: 1,
        });
      } catch (err: any) {
        Alert.alert('Recording Error', err.message);
      }
    }
  };

  // Stop recording
  const handleStopRecording = async () => {
    if (!currentRecording || !activeCharacter) return;
    isRecordingRef.current = false;

    try {
      // Stop STT
      ExpoSpeechRecognitionModule.stop();

      // Stop and save recording
      const result = await stopRecording(currentRecording);
      const lineText = transcriptRef.current.trim() || '';

      // Add to recorded lines
      if (lineText) {
        const newLine: RecordedLine = {
          id: `line_${recordedLines.length}`,
          character: activeCharacter,
          text: lineText,
          audioUri: result.uri,
          durationMs: result.durationMs,
        };
        setRecordedLines([newLine, ...recordedLines]);
      }

      // Reset state
      setCurrentRecording(null);
      setActiveCharacter(null);
      currentCharacterRef.current = null;
      setTranscript('');
      transcriptRef.current = '';
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // Move to review step
  const handleDoneRecording = () => {
    if (recordedLines.length === 0) {
      Alert.alert('No Lines Recorded', 'Record at least one line to continue.');
      return;
    }
    setEditedLines(recordedLines.map((l) => ({ ...l })));
    setStep('review');
  };

  // Delete a line in review
  const handleDeleteLine = (lineId: string) => {
    setEditedLines(editedLines.filter((l) => l.id !== lineId));
  };

  // Edit line text in review
  const handleEditLineText = (lineId: string, newText: string) => {
    setEditedLines(
      editedLines.map((l) => (l.id === lineId ? { ...l, text: newText } : l))
    );
  };

  // Play audio for a line
  const handlePlayAudio = async (uri: string) => {
    try {
      await playAudio(uri);
    } catch (err: any) {
      Alert.alert('Playback Error', err.message);
    }
  };

  // Move to save step
  const handleMoveToSave = () => {
    if (editedLines.length === 0) {
      Alert.alert('No Lines', 'You must have at least one line to save.');
      return;
    }
    setStep('save');
    if (editedLines[0]) {
      setSelectedCharacter(editedLines[0].character);
    }
  };

  // Save the scene
  const handleSaveScene = async () => {
    if (!sceneTitle.trim()) {
      Alert.alert('Scene Title Required', 'Please enter a scene title.');
      return;
    }

    if (addToExisting && !selectedScriptId) {
      Alert.alert('Select Script', 'Please select a script to add to.');
      return;
    }

    if (!addToExisting && !scriptTitle.trim()) {
      Alert.alert('Script Title Required', 'Please enter a script title.');
      return;
    }

    if (!selectedCharacter) {
      Alert.alert('Character Required', 'Please select a character.');
      return;
    }

    setIsSaving(true);

    try {
      // Create Line objects from edited lines
      const lines: Line[] = editedLines.map((el, idx) => ({
        id: `line_${el.id}`,
        character: el.character,
        text: el.text,
        type: 'spoken' as LineType,
        audioUri: el.audioUri,
        cues: [], // Will be populated with cue lines if available
      }));

      // Create Scene object
      const newScene: Scene = {
        id: `scene_${Date.now()}`,
        number: 1,
        title: sceneTitle,
        lines,
      };

      if (addToExisting && selectedScriptId) {
        // Add to existing script
        const existingScript = existingScripts.find((s) => s.id === selectedScriptId);
        if (!existingScript) throw new Error('Script not found');

        const updatedScript: Script = {
          ...existingScript,
          scenes: [
            ...existingScript.scenes,
            {
              ...newScene,
              number: existingScript.scenes.length + 1,
            },
          ],
        };

        await saveScript(updatedScript);
      } else {
        // Create new script
        const newScript: Script = {
          id: `script_${Date.now()}`,
          title: scriptTitle.trim(),
          characters: [selectedCharacter],
          selectedCharacter,
          scenes: [newScene],
          createdAt: new Date().toISOString(),
          sourceType: 'recorded',
        };

        await saveScript(newScript);
      }

      Alert.alert('Success', 'Scene saved!', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (err: any) {
      Alert.alert('Save Error', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // TITLE STEP
  if (step === 'title') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>New Script</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.form}>
          <Text style={styles.stepTitle}>What's the name of your script?</Text>
          <Text style={styles.stepSub}>
            This will be the title of your script. You can record multiple scenes for it.
          </Text>

          <Text style={styles.label}>Script Title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Hamlet, Romeo & Juliet..."
            placeholderTextColor={Colors.textLight}
            value={scriptTitle}
            onChangeText={setScriptTitle}
            autoFocus
          />
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="Continue"
            onPress={() => setStep('setup')}
            disabled={!scriptTitle.trim()}
          />
        </View>
      </SafeAreaView>
    );
  }

  // SETUP STEP
  if (step === 'setup') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Record a Scene</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.form}>
          <Text style={styles.stepTitle}>Scene Details</Text>

          <Text style={styles.label}>Scene Title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Act 1, Scene 1"
            placeholderTextColor={Colors.textLight}
            value={sceneTitle}
            onChangeText={setSceneTitle}
            autoFocus
          />

          <Text style={styles.label} style={{ marginTop: Spacing.lg }}>
            Characters in This Scene
          </Text>
          <View style={styles.characterInputRow}>
            <TextInput
              style={styles.characterInput}
              placeholder="Character name"
              placeholderTextColor={Colors.textLight}
              value={characterInput}
              onChangeText={setCharacterInput}
              onSubmitEditing={handleAddCharacter}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleAddCharacter}>
              <Ionicons name="add" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>

          {characters.length > 0 && (
            <View style={styles.characterChips}>
              {characters.map((char) => (
                <View key={char} style={styles.chip}>
                  <Text style={styles.chipText}>{char}</Text>
                  <TouchableOpacity onPress={() => handleRemoveCharacter(char)}>
                    <Ionicons name="close-circle-outline" size={16} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.helpText}>
            {characters.length === 0
              ? 'Add at least one character to continue.'
              : `Ready to record ${characters.length} character${characters.length !== 1 ? 's' : ''}.`}
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="Begin Recording"
            onPress={() => setStep('record')}
            disabled={characters.length === 0}
          />
        </View>
      </SafeAreaView>
    );
  }

  // RECORD STEP
  if (step === 'record') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setStep('setup')} style={styles.closeBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>{sceneTitle}</Text>
          <Text style={styles.lineCount}>Lines: {recordedLines.length}</Text>
        </View>

        <ScrollView style={styles.scroll}>
          {/* Character buttons */}
          <View style={styles.characterButtons}>
            {characters.map((char) => (
              <TouchableOpacity
                key={char}
                style={[
                  styles.charBtn,
                  activeCharacter === char && styles.charBtnActive,
                ]}
                onPress={() => handleStartRecording(char)}
              >
                <Text
                  style={[
                    styles.charBtnText,
                    activeCharacter === char && styles.charBtnTextActive,
                  ]}
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}
                >
                  {char}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Recording indicator */}
          {activeCharacter && (
            <Card style={styles.recordingCard}>
              <View style={styles.recordingRow}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>
                  Recording {activeCharacter}...
                </Text>
              </View>
              {transcript && <Text style={styles.transcriptText}>{transcript}</Text>}
            </Card>
          )}

          {/* Recent lines list */}
          {recordedLines.length > 0 && (
            <View style={styles.linesList}>
              <Text style={styles.linesTitle}>Recorded Lines</Text>
              {recordedLines.map((line) => (
                <Card key={line.id} style={styles.lineCard}>
                  <View style={styles.lineRow}>
                    <View style={styles.lineInfo}>
                      <Text style={styles.lineCharacter}>{line.character}</Text>
                      <Text style={styles.lineText} numberOfLines={2}>
                        {line.text}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handlePlayAudio(line.audioUri)}>
                      <Ionicons name="play-circle-outline" size={24} color={Colors.accent} />
                    </TouchableOpacity>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button label="Done Recording" onPress={handleDoneRecording} />
        </View>
      </SafeAreaView>
    );
  }

  // REVIEW STEP
  if (step === 'review') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setStep('record')} style={styles.closeBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Review Lines</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.scroll}>
          {editedLines.map((line) => (
            <Card key={line.id} style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <Text style={styles.reviewCharacter}>{line.character}</Text>
                <TouchableOpacity onPress={() => handleDeleteLine(line.id)}>
                  <Ionicons name="trash-outline" size={20} color={Colors.error} />
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.reviewInput}
                value={line.text}
                onChangeText={(text) => handleEditLineText(line.id, text)}
                placeholder="Edit line text..."
                placeholderTextColor={Colors.textLight}
                multiline
              />

              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => handlePlayAudio(line.audioUri)}
              >
                <Ionicons name="play" size={16} color={Colors.white} />
                <Text style={styles.playBtnText}>Play Recording</Text>
              </TouchableOpacity>
            </Card>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <Button label="Save Scene →" onPress={handleMoveToSave} />
        </View>
      </SafeAreaView>
    );
  }

  // SAVE STEP
  if (step === 'save') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setStep('review')} style={styles.closeBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Save Scene</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.form}>
          <Text style={styles.stepTitle}>Where to save?</Text>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, !addToExisting && styles.toggleBtnActive]}
              onPress={() => {
                setAddToExisting(false);
                setSelectedScriptId(null);
              }}
            >
              <Text style={[
                styles.toggleBtnText,
                !addToExisting && styles.toggleBtnTextActive,
              ]}>
                New Script
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, addToExisting && styles.toggleBtnActive]}
              onPress={() => {
                setAddToExisting(true);
                if (existingScripts.length > 0) {
                  setSelectedScriptId(existingScripts[0].id);
                }
              }}
            >
              <Text style={[
                styles.toggleBtnText,
                addToExisting && styles.toggleBtnTextActive,
              ]}>
                Existing Script
              </Text>
            </TouchableOpacity>
          </View>

          {!addToExisting ? (
            <>
              <Card style={styles.section}>
                <Text style={styles.label}>Script Title</Text>
                <Text style={styles.scriptTitleDisplay}>{scriptTitle}</Text>
              </Card>
            </>
          ) : (
            <>
              <Text style={styles.label}>Select Script</Text>
              <ScrollView style={styles.scriptList}>
                {existingScripts.map((script) => (
                  <TouchableOpacity
                    key={script.id}
                    style={[
                      styles.scriptOption,
                      selectedScriptId === script.id && styles.scriptOptionSelected,
                    ]}
                    onPress={() => setSelectedScriptId(script.id)}
                  >
                    <Text style={styles.scriptOptionText}>{script.title}</Text>
                    <Ionicons
                      name={selectedScriptId === script.id ? 'checkmark-circle' : 'circle-outline'}
                      size={20}
                      color={Colors.accent}
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>
            Who are you playing?
          </Text>
          <ScrollView style={styles.charList} horizontal showsHorizontalScrollIndicator={false}>
            {characters.map((char) => (
              <TouchableOpacity
                key={char}
                style={[
                  styles.charSelectBtn,
                  selectedCharacter === char && styles.charSelectBtnActive,
                ]}
                onPress={() => setSelectedCharacter(char)}
              >
                <Text style={[
                  styles.charSelectBtnText,
                  selectedCharacter === char && styles.charSelectBtnTextActive,
                ]}>
                  {char}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={isSaving ? 'Saving...' : 'Save Scene'}
            onPress={handleSaveScene}
            disabled={isSaving}
            loading={isSaving}
          />
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },
  lineCount: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  scroll: {
    flex: 1,
  },
  form: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: 120,
  },
  stepTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  stepSub: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    lineHeight: 22,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  characterInputRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  characterInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  characterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chipText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.white,
  },
  helpText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  characterButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  charBtn: {
    flex: 0.5,
    minHeight: 80,
    borderRadius: Radius.lg,
    backgroundColor: Colors.accent,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charBtnActive: {
    backgroundColor: Colors.accentDark,
    opacity: 0.9,
  },
  charBtnText: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.white,
    textAlign: 'center',
  },
  charBtnTextActive: {
    color: Colors.white,
  },
  recordingCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: Radius.full,
    backgroundColor: Colors.error,
  },
  recordingText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.error,
  },
  transcriptText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  linesList: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  linesTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  lineCard: {
    marginBottom: Spacing.xs,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  lineInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  lineCharacter: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lineText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 18,
  },
  reviewCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewCharacter: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reviewInput: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  playBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.white,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  toggleBtnText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  toggleBtnTextActive: {
    color: Colors.white,
  },
  scriptTitleDisplay: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  scriptList: {
    maxHeight: 200,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scriptOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  scriptOptionSelected: {
    backgroundColor: Colors.surfaceAlt,
  },
  scriptOptionText: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  charList: {
    marginTop: Spacing.sm,
  },
  charSelectBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: Spacing.sm,
  },
  charSelectBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  charSelectBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  charSelectBtnTextActive: {
    color: Colors.white,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
});
