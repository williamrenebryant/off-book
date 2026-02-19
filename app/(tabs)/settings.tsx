import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getSettings, saveSettings } from '@/lib/storage';
import { getAudioStorageUsed, deleteAllAudio } from '@/lib/audio';
import { AppSettings } from '@/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>({
    anthropicApiKey: '',
    speechLanguage: 'en-US',
    cueContext: 1,
    autoAdvance: false,
    hasAcceptedTerms: false,
    audioCueMode: 'text',
    audioStorageSubscribed: false,
  });
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [audioUsed, setAudioUsed] = useState(0);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [isDeletingAudio, setIsDeletingAudio] = useState(false);

  const AUDIO_LIMIT = 500 * 1024 * 1024; // 500 MB

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    loadAudioStorage();
  }, []);

  const loadAudioStorage = async () => {
    setLoadingAudio(true);
    try {
      const used = await getAudioStorageUsed();
      setAudioUsed(used);
    } catch (err) {
      console.warn('Failed to load audio storage:', err);
    } finally {
      setLoadingAudio(false);
    }
  };

  const handleDeleteAllAudio = () => {
    Alert.alert(
      'Delete All Recordings?',
      'This will permanently delete all recorded audio files. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingAudio(true);
            try {
              await deleteAllAudio();
              setAudioUsed(0);
              Alert.alert('Success', 'All recordings deleted.');
            } catch (err: any) {
              Alert.alert('Error', err.message);
            } finally {
              setIsDeletingAudio(false);
            }
          },
        },
      ]
    );
  };

  const handleUpgradeStorage = async () => {
    Alert.alert(
      'Upgrade Storage',
      'In-app purchases will be available in a future release. For now, manage your 500MB limit by deleting old recordings.'
    );
  };

  const handleSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCueContext = (n: number) => {
    setSettings((s) => ({ ...s, cueContext: n }));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Anthropic API Key</Text>
          <Text style={styles.sectionDesc}>
            Advanced: Enter your own Anthropic API key to skip in-app purchases and call Claude directly. Leave blank to use the standard in-app purchase flow.
          </Text>
          <View style={styles.keyRow}>
            <TextInput
              style={styles.keyInput}
              value={settings.anthropicApiKey}
              onChangeText={(v) => setSettings((s) => ({ ...s, anthropicApiKey: v }))}
              placeholder="sk-ant-..."
              placeholderTextColor={Colors.textLight}
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowKey((v) => !v)} style={styles.eyeBtn}>
              <Ionicons
                name={showKey ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Cue Lines</Text>
          <Text style={styles.sectionDesc}>
            How many lines before yours to show as context during practice.
          </Text>
          <View style={styles.cueRow}>
            {[1, 2, 3].map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.cueOption, settings.cueContext === n && styles.cueOptionActive]}
                onPress={() => handleCueContext(n)}
              >
                <Text
                  style={[
                    styles.cueOptionText,
                    settings.cueContext === n && styles.cueOptionTextActive,
                  ]}
                >
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Card style={styles.section}>
          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.sectionTitle}>Auto-advance</Text>
              <Text style={styles.sectionDesc}>
                Automatically move to the next line after a correct attempt.
              </Text>
            </View>
            <Switch
              value={settings.autoAdvance}
              onValueChange={(v) => setSettings((s) => ({ ...s, autoAdvance: v }))}
              trackColor={{ false: Colors.border, true: Colors.accent }}
              thumbColor={Colors.white}
            />
          </View>
        </Card>

        <Button
          label={saved ? 'Saved!' : 'Save Settings'}
          onPress={handleSave}
          style={styles.saveBtn}
        />

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Audio Storage</Text>

          {loadingAudio ? (
            <ActivityIndicator size="small" color={Colors.accent} />
          ) : (
            <>
              <View style={styles.storageRow}>
                <View style={styles.storageInfo}>
                  <Text style={styles.storageLabel}>
                    {(audioUsed / (1024 * 1024)).toFixed(1)} MB of 500 MB
                  </Text>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min(100, (audioUsed / AUDIO_LIMIT) * 100)}%`,
                          backgroundColor:
                            audioUsed > AUDIO_LIMIT
                              ? Colors.error
                              : audioUsed > AUDIO_LIMIT * 0.8
                              ? Colors.warning
                              : Colors.success,
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>

              <Button
                label="Delete All Recordings"
                variant="secondary"
                onPress={handleDeleteAllAudio}
                disabled={audioUsed === 0 || isDeletingAudio}
                style={{ marginTop: Spacing.sm }}
              />

              {audioUsed > AUDIO_LIMIT && !settings.audioStorageSubscribed && (
                <Button
                  label="Upgrade for Unlimited Storage"
                  onPress={handleUpgradeStorage}
                  style={{ marginTop: Spacing.sm }}
                />
              )}
            </>
          )}
        </Card>

        <Card variant="accent" style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <View style={styles.legalContent}>
            <Text style={styles.sectionDesc}>
              <Text style={styles.legalBold}>Terms & Conditions</Text>
              {'\n'}You are responsible for the scripts you upload. Review full terms when you agreed to use this app.
            </Text>
            <Text style={styles.copyrightNotice}>
              © Cue Line. Scripts uploaded remain your responsibility. For legal inquiries, contact the app developer.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.viewTermsBtn}
            onPress={() => {
              Alert.alert(
                'View Terms & Conditions',
                'To review the full Terms & Conditions, you can reinstall the app or contact support. The T&C were presented when you first opened Cue Line.',
                [{ text: 'OK', style: 'default' }]
              );
            }}
          >
            <Text style={styles.viewTermsBtnText}>View Full Terms</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.purple} />
          </TouchableOpacity>
        </Card>

        <Text style={styles.version}>Cue Line · v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  header: {
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  sectionDesc: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginTop: Spacing.xs,
  },
  keyInput: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: FontSize.sm,
    color: Colors.text,
    fontFamily: 'monospace',
  },
  eyeBtn: {
    padding: Spacing.sm,
  },
  cueRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  cueOption: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cueOptionActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  cueOptionText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  cueOptionTextActive: {
    color: Colors.white,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  switchInfo: {
    flex: 1,
    gap: 2,
  },
  saveBtn: {
    marginTop: Spacing.sm,
  },
  version: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: Spacing.md,
  },
  legalContent: {
    gap: Spacing.sm,
  },
  legalBold: {
    fontWeight: '700',
    color: Colors.text,
  },
  copyrightNotice: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  viewTermsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    marginTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  viewTermsBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.purple,
  },
  storageRow: {
    gap: Spacing.sm,
  },
  storageInfo: {
    gap: Spacing.sm,
  },
  storageLabel: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: '500',
  },
  progressBar: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.full,
  },
});
