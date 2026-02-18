import React, { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { extractPdfText } from '../modules/pdf-text-extractor/src';
import { parseScript } from '@/lib/claude';
import { saveScript, getSettings } from '@/lib/storage';
import { Script } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

type Step = 'pick' | 'title' | 'parsing' | 'character';

export default function UploadScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [fileUri, setFileUri] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [parsedScript, setParsedScript] = useState<Omit<Script, 'id' | 'createdAt' | 'selectedCharacter'> | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [statusText, setStatusText] = useState('');

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
    setStep('title');
  };

  const handleParseScript = async () => {
    const settings = await getSettings();
    if (!settings.anthropicApiKey) {
      Alert.alert(
        'API Key Required',
        'Please add your Anthropic API key in Settings before uploading a script.',
        [{ text: 'OK' }]
      );
      return;
    }

    setStep('parsing');
    setStatusText('Reading your script...');

    try {
      let scriptText = '';

      if (mimeType === 'text/plain') {
        scriptText = fileBase64;
      } else {
        setStatusText('Extracting text from PDF...');
        scriptText = await extractPdfText(fileUri);  // native, no API key
      }
      setStatusText('Identifying characters and scenes...');

      const result = await parseScript(settings.anthropicApiKey, scriptText, title);
      setParsedScript(result);
      setStep('character');
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
      setStep('title');
    }
  };

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
});
