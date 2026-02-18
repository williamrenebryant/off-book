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
import { File as ExpoFile } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
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

    // PDFs are sent as base64 — reject files too large for the request
    const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB
    if (asset.mimeType !== 'text/plain' && asset.size && asset.size > MAX_PDF_BYTES) {
      Alert.alert(
        'PDF Too Large',
        `This PDF is ${(asset.size / (1024 * 1024)).toFixed(1)} MB. Please use a PDF under 8 MB, or export your script as a .txt file instead.`
      );
      return;
    }

    setFileName(asset.name);
    setFileUri(asset.uri);
    setMimeType(asset.mimeType ?? 'application/pdf');

    // Read file as base64 for PDF, or as text for txt files
    const file = new ExpoFile(asset.uri);
    if (asset.mimeType === 'text/plain') {
      const text = await file.text();
      setFileBase64(text);
    } else {
      const b64 = await file.base64();
      setFileBase64(b64);
    }

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
        setStatusText('Identifying characters and scenes...');
      } else {
        // For PDF, we send it directly to Claude as a document
        setStatusText('Extracting text from PDF...');
        scriptText = await extractPdfText(settings.anthropicApiKey, fileBase64, title);
        setStatusText('Identifying characters and scenes...');
      }

      const result = await parseScript(settings.anthropicApiKey, scriptText, title);
      setParsedScript(result);
      setStep('character');
    } catch (err: any) {
      const msg: string = err.message ?? 'Something went wrong parsing the script.';
      const isOverloaded = msg.includes('529') || msg.includes('overloaded');
      Alert.alert(
        isOverloaded ? 'Claude is Busy' : 'Parse Error',
        isOverloaded
          ? 'Anthropic\'s servers are overloaded right now. Wait a moment and try again.'
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
          <Text style={styles.parsingSubtext}>This takes about 15–30 seconds</Text>
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

async function extractPdfText(apiKey: string, base64: string, title: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.anthropic.com/v1/messages');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('x-api-key', apiKey);
    xhr.setRequestHeader('anthropic-version', '2023-06-01');
    xhr.timeout = 120000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        resolve(data.content[0].text);
      } else {
        reject(new Error(`PDF extraction failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.ontimeout = () => reject(new Error('Request timed out — try a smaller PDF or use a .txt file'));
    xhr.send(
      JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 },
              },
              {
                type: 'text',
                text: `This is a theatre or film script. Extract ALL the text exactly as it appears.

CRITICAL — preserve these formatting details precisely:
- Character names that appear before dialogue (e.g. "HAMLET", "JULIE:", "Tom:") — keep them on their own line, exactly as capitalised
- Scene and act headings (e.g. "ACT ONE", "SCENE 2", "INT. KITCHEN - DAY") — keep on their own line
- Stage directions in parentheses or brackets — keep them
- Every line of dialogue — keep each speaker's text on its own line(s)
- Blank lines between speeches — preserve them

Do NOT summarise, paraphrase, or skip any content. Output only the raw extracted text, nothing else.`,
              },
            ],
          },
        ],
      })
    );
  });
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
