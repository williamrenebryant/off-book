import React, { useState, useEffect } from 'react';
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
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Directory, Paths } from 'expo-file-system';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { extractPdfText } from '../modules/pdf-text-extractor/src';
import { parseScript } from '@/lib/claude';
import { saveScript, getScript, getSettings } from '@/lib/storage';
import { Script } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

type Step = 'pick' | 'title' | 'parsing' | 'character' | 'merge_confirm';

export default function UploadScreen() {
  const router = useRouter();
  const { appendToScriptId } = useLocalSearchParams<{ appendToScriptId?: string }>();
  const [existingScript, setExistingScript] = useState<Script | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [fileUri, setFileUri] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [parsedScript, setParsedScript] = useState<Omit<Script, 'id' | 'createdAt' | 'selectedCharacter'> | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [statusText, setStatusText] = useState('');

  useEffect(() => {
    if (appendToScriptId) getScript(appendToScriptId).then(setExistingScript);
  }, [appendToScriptId]);

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/plain', 'text/rtf'],
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const asset = result.assets[0];

    setFileName(asset.name);
    setFileUri(asset.uri);
    setMimeType(asset.mimeType ?? 'application/pdf');

    if (asset.mimeType === 'text/plain') {
      const file = new ExpoFile(asset.uri);
      const text = await file.text();
      setFileBase64(text);
    }
    // PDF: fileUri is used directly — no base64 needed

    // Auto-fill title from filename
    const guessedTitle = asset.name.replace(/\.(pdf|txt|rtf)$/i, '').replace(/[-_]/g, ' ');
    setTitle(guessedTitle);

    if (appendToScriptId) {
      setStep('parsing');  // will auto-trigger via useEffect
    } else {
      setStep('title');
    }
  };

  const handleParseScript = async () => {
    const settings = await getSettings();

    setStep('parsing');
    setStatusText('Reading your script...');

    try {
      let scriptText = '';

      if (mimeType === 'text/plain') {
        scriptText = fileBase64;
      } else {
        setStatusText('Extracting text from PDF...');
        scriptText = await extractPdfText(fileUri);
      }

      // Guard: scanned PDF with no extractable text
      if (scriptText.trim().length < 100) {
        Alert.alert(
          'Scanned PDF Detected',
          'This PDF appears to be image-based and contains no extractable text. Export your script as a .txt file instead.'
        );
        setStep(appendToScriptId ? 'pick' : 'title');
        return;
      }

      // Parse with API key
      if (!settings.anthropicApiKey) {
        Alert.alert(
          'API Key Required',
          'Set your Anthropic API key in Settings to parse scripts. In-app purchases are not available in this version.'
        );
        setStep(appendToScriptId ? 'pick' : 'title');
        return;
      }

      setStatusText('Identifying characters and scenes...');
      const result = await parseScript(settings.anthropicApiKey, scriptText, title);
      setParsedScript(result);
      setStep(appendToScriptId ? 'merge_confirm' : 'character');

    } catch (err: any) {
      const msg: string = err.message ?? 'Something went wrong parsing the script.';
      const isOverloaded = msg.includes('529') || msg.includes('overloaded');
      const isFiltered = msg.includes('content filtering') || msg.includes('content_policy');
      const isScannedPdf = msg.includes('image-based') || msg.includes('no extractable text');
      Alert.alert(
        isOverloaded
          ? 'Claude is Busy'
          : isFiltered
          ? 'PDF Blocked by Content Filter'
          : isScannedPdf
          ? 'Scanned PDF Detected'
          : 'Parse Error',
        isOverloaded
          ? "Anthropic's servers are overloaded right now. Wait a moment and try again."
          : isFiltered
          ? "This PDF's content is being blocked by Anthropic's safety filter. Try exporting your script as a plain text (.txt) file — that works reliably."
          : isScannedPdf
          ? "This PDF appears to be image-based (scanned) and contains no extractable text. Export your script as a .txt file instead."
          : msg
      );
      setStep(appendToScriptId ? 'pick' : 'title');
    }
  };


  // Auto-trigger parse when entering 'parsing' step in append mode
  useEffect(() => {
    if (step === 'parsing' && appendToScriptId && (fileUri || fileBase64)) {
      handleParseScript();
    }
  }, [step, appendToScriptId]);

  const handleSaveScript = async () => {
    if (!parsedScript || !selectedCharacter) return;

    const script: Script = {
      id: Date.now().toString(),
      ...parsedScript,
      selectedCharacter,
      createdAt: new Date().toISOString(),
    };

    if (mimeType !== 'text/plain' && fileUri) {
      const dir = new Directory(Paths.document, 'scripts');
      dir.create({ intermediates: true, idempotent: true });
      const dest = new ExpoFile(dir, `${script.id}.pdf`);
      const src = new ExpoFile(fileUri);
      src.copy(dest);
      script.pdfUri = dest.uri;
    }

    await saveScript(script);
    router.replace(`/script/${script.id}`);
  };

  const handleMergeScenes = async () => {
    if (!parsedScript || !existingScript) return;

    const ts = Date.now();
    const newScenes = parsedScript.scenes.map((sc, si) => ({
      ...sc,
      id: `${ts}_s${si}`,
      lines: sc.lines.map((l, li) => ({
        ...l,
        id: `${ts}_l${si}_${li}`,
      })),
    }));

    const allChars = Array.from(new Set([...existingScript.characters, ...parsedScript.characters]));

    const updatedScript: Script = {
      ...existingScript,
      characters: allChars,
      scenes: [...existingScript.scenes, ...newScenes],
    };

    if (mimeType !== 'text/plain' && fileUri) {
      const dir = new Directory(Paths.document, 'scripts');
      dir.create({ intermediates: true, idempotent: true });
      const dest = new ExpoFile(dir, `${existingScript.id}_${ts}.pdf`);
      new ExpoFile(fileUri).copy(dest);
    }

    await saveScript(updatedScript);
    router.replace(`/script/${existingScript.id}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Add Script</Text>
        <View style={{ width: 40 }} />
      </View>

      {step === 'pick' && (
        <View style={styles.centered}>
          <TouchableOpacity style={styles.dropZone} onPress={handlePickFile} activeOpacity={0.75}>
            <Ionicons name="cloud-upload-outline" size={48} color={Colors.accent} />
            <Text style={styles.dropTitle}>Upload your script</Text>
            <Text style={styles.dropSub}>PDF, TXT, or RTF supported</Text>
          </TouchableOpacity>

          <Card style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Ionicons name="alert-circle-outline" size={20} color={Colors.warning} />
              <Text style={styles.warningText}>
                You are responsible for ensuring you have the right to use this material. Only upload scripts you own or have licensed.
              </Text>
            </View>
          </Card>
        </View>
      )}

      {step === 'title' && (
        <View style={styles.form}>
          <Card style={styles.fileCard}>
            <View style={styles.fileRow}>
              <Ionicons name="document-text" size={20} color={Colors.accent} />
              <Text style={styles.fileName} numberOfLines={1}>
                {fileName}
              </Text>
              <TouchableOpacity onPress={() => setStep('pick')}>
                <Ionicons name="close-circle" size={20} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
          </Card>

          <Card style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Ionicons name="alert-circle-outline" size={20} color={Colors.warning} />
              <Text style={styles.warningText}>
                You are responsible for ensuring you have the right to use this material. Only upload scripts you own or have licensed.
              </Text>
            </View>
          </Card>

          <Text style={styles.label}>Script Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Hamlet, South Pacific..."
            placeholderTextColor={Colors.textLight}
            autoFocus
          />

          <Button
            label="Parse Script"
            onPress={handleParseScript}
            disabled={!title.trim()}
            style={styles.actionBtn}
          />
        </View>
      )}


      {step === 'parsing' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.parsingText}>{statusText}</Text>
          <Text style={styles.parsingSubtext}>This usually takes a few seconds</Text>
        </View>
      )}

      {step === 'character' && parsedScript && (
        <View style={styles.form}>
          <Text style={styles.stepTitle}>Who are you playing?</Text>
          <Text style={styles.stepSub}>
            Found {parsedScript.characters.length} characters in {parsedScript.scenes.length} scenes.
          </Text>

          <ScrollView style={styles.charList} showsVerticalScrollIndicator={false}>
            {parsedScript.characters.map((char) => (
              <TouchableOpacity
                key={char}
                style={[
                  styles.charOption,
                  selectedCharacter === char && styles.charOptionSelected,
                ]}
                onPress={() => setSelectedCharacter(char)}
                activeOpacity={0.75}
              >
                <View style={styles.charOptionInner}>
                  <Text
                    style={[
                      styles.charName,
                      selectedCharacter === char && styles.charNameSelected,
                    ]}
                  >
                    {char}
                  </Text>
                  <Text style={styles.charLineCount}>
                    {countLines(parsedScript, char)} lines
                  </Text>
                </View>
                {selectedCharacter === char && (
                  <Ionicons name="checkmark-circle" size={22} color={Colors.accent} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Button
            label="Start Memorizing"
            onPress={handleSaveScript}
            disabled={!selectedCharacter}
            style={styles.actionBtn}
          />
        </View>
      )}

      {step === 'merge_confirm' && parsedScript && existingScript && (
        <View style={styles.form}>
          <Text style={styles.stepTitle}>Adding to "{existingScript.title}"</Text>
          <Text style={styles.stepSub}>
            {existingScript.selectedCharacter} · {parsedScript.scenes.length} new{' '}
            {parsedScript.scenes.length === 1 ? 'scene' : 'scenes'} found
          </Text>

          <ScrollView style={styles.charList} showsVerticalScrollIndicator={false}>
            {parsedScript.scenes.map((sc) => {
              const myLines = sc.lines.filter(l => l.character === existingScript.selectedCharacter);
              return (
                <View key={sc.id} style={[styles.charOption, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                  <Text style={styles.charName}>{sc.title}</Text>
                  <Text style={styles.charLineCount}>
                    {myLines.length} line{myLines.length !== 1 ? 's' : ''} for your character
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <Button
            label={`Add ${parsedScript.scenes.length} ${parsedScript.scenes.length === 1 ? 'Scene' : 'Scenes'}`}
            onPress={handleMergeScenes}
            style={styles.actionBtn}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

function countLines(
  script: Omit<Script, 'id' | 'createdAt' | 'selectedCharacter'>,
  character: string
): number {
  return script.scenes.reduce(
    (total, scene) =>
      total + scene.lines.filter((l) => l.character === character).length,
    0
  );
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  dropZone: {
    width: '100%',
    aspectRatio: 1.4,
    borderRadius: Radius.xl,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    gap: Spacing.sm,
  },
  dropTitle: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    color: Colors.text,
  },
  dropSub: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  form: {
    flex: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  fileCard: {
    padding: Spacing.sm,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  fileName: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: '500',
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    fontSize: FontSize.lg,
    color: Colors.text,
  },
  actionBtn: {
    marginTop: Spacing.sm,
  },
  tierCard: {
    gap: Spacing.sm,
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  tierInfo: {
    flex: 1,
  },
  tierLabel: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  tierSize: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: 1,
  },
  tierPrice: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.accent,
  },
  tierNote: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  errorText: {
    fontSize: FontSize.sm,
    color: Colors.error,
    lineHeight: 18,
  },
  parsingText: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },
  parsingSubtext: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  stepTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
  },
  stepSub: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
  },
  charList: {
    flex: 1,
  },
  charOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  charOptionSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.background,
  },
  charOptionInner: {
    flex: 1,
  },
  charName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  charNameSelected: {
    color: Colors.accent,
  },
  charLineCount: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: 1,
  },
  warningCard: {
    marginHorizontal: 0,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 18,
  },
});
