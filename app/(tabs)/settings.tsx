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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getSettings, saveSettings } from '@/lib/storage';
import { AppSettings } from '@/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>({
    anthropicApiKey: '',
    speechLanguage: 'en-US',
    cueContext: 1,
    autoAdvance: false,
  });
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

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
            Required for script parsing, line feedback, and coaching. Get a key at console.anthropic.com.
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

        <Text style={styles.version}>Off Book · v1.0.0</Text>
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
});
