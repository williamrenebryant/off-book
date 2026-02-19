import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

type Step = 'title' | 'options';

export default function CreateScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('title');
  const [scriptTitle, setScriptTitle] = useState('');

  const handleContinue = () => {
    if (scriptTitle.trim()) {
      setStep('options');
    }
  };

  const handleRecord = () => {
    router.push({
      pathname: '/record',
      params: { scriptTitle: scriptTitle.trim() },
    });
  };

  const handleUpload = () => {
    router.push({ pathname: '/upload', params: { scriptTitle: scriptTitle.trim() } });
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
          <Text style={styles.title}>What's the name of your script?</Text>
          <Text style={styles.subtitle}>
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
            onPress={handleContinue}
            disabled={!scriptTitle.trim()}
          />
        </View>
      </SafeAreaView>
    );
  }

  // OPTIONS STEP
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => setStep('title')} style={styles.closeBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Create Script</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>How would you like to add scenes?</Text>
          <Text style={styles.scriptTitleDisplay}>{scriptTitle}</Text>
        </View>

        {/* Main option: Record a scene */}
        <TouchableOpacity
          style={styles.primaryOption}
          onPress={handleRecord}
          activeOpacity={0.85}
        >
          <View style={styles.primaryContent}>
            <View style={styles.primaryIconBg}>
              <Ionicons name="mic" size={32} color={Colors.white} />
            </View>
            <View style={styles.primaryText}>
              <Text style={styles.primaryTitle}>Record a Scene</Text>
              <Text style={styles.primaryDesc}>
                Speak your lines and create scenes from your recordings
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.accent} />
          </View>
        </TouchableOpacity>

        {/* Secondary option: Upload from file */}
        <Card style={styles.secondaryOption}>
          <TouchableOpacity
            style={styles.secondaryContent}
            onPress={handleUpload}
            activeOpacity={0.75}
          >
            <View style={styles.secondaryIconBg}>
              <Ionicons name="cloud-upload-outline" size={20} color={Colors.accent} />
            </View>
            <View style={styles.secondaryText}>
              <Text style={styles.secondaryTitle}>Upload from PDF or TXT</Text>
              <Text style={styles.secondaryDesc}>
                Parse an existing script file
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
          </TouchableOpacity>
        </Card>
      </View>
    </SafeAreaView>
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: {
    width: 40,
    alignItems: 'center',
  },
  topTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },

  // Title step
  scroll: {
    flex: 1,
  },
  form: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: 120,
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
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
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
    marginTop: Spacing.lg,
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

  // Options step
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.sm,
  },
  scriptTitleDisplay: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.accent,
  },

  // Primary option
  primaryOption: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    shadowColor: Colors.accentDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  primaryIconBg: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  primaryText: {
    flex: 1,
    gap: Spacing.xs,
  },
  primaryTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.white,
  },
  primaryDesc: {
    fontSize: FontSize.sm,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 18,
  },

  // Secondary option
  secondaryOption: {
    gap: Spacing.sm,
  },
  secondaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  secondaryIconBg: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  secondaryText: {
    flex: 1,
    gap: 2,
  },
  secondaryTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  secondaryDesc: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
});
