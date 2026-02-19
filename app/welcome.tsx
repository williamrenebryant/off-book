import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { saveSettings } from '@/lib/storage';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

export default function WelcomeScreen() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  const handleAgree = async () => {
    if (!agreed) return;
    await saveSettings({ hasAcceptedTerms: true });
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Cue Line</Text>
        <Text style={styles.subtitle}>
          AI-powered practice for actors
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Welcome</Text>
          <Text style={styles.sectionText}>
            Cue Line helps you memorize and practice script lines using speech recognition and AI feedback. Your practice data stays on your device—no cloud backups.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Terms & Conditions</Text>

          <Card style={styles.tcCard}>
            <Text style={styles.tcSubtitle}>Your Responsibility</Text>
            <Text style={styles.tcBody}>
              You are responsible for ensuring you have the right to use any scripts or materials you upload or record in Cue Line. The creators of Cue Line are not responsible for copyright infringement or any unauthorized use of intellectual property.
            </Text>
          </Card>

          <Card style={styles.tcCard}>
            <Text style={styles.tcSubtitle}>No Warranty</Text>
            <Text style={styles.tcBody}>
              Cue Line is provided as-is without warranty. Speech recognition accuracy may vary. The app creators are not liable for any issues arising from its use, including failed practice sessions or inaccurate feedback.
            </Text>
          </Card>

          <Card style={styles.tcCard}>
            <Text style={styles.tcSubtitle}>Your Data</Text>
            <Text style={styles.tcBody}>
              All your scripts, recordings, and practice progress are stored locally on your device. They are never sent to external servers (except when you upload a script for AI parsing, which requires an API key). You can delete everything at any time.
            </Text>
          </Card>

          <Card style={styles.tcCard}>
            <Text style={styles.tcSubtitle}>Third-Party Services</Text>
            <Text style={styles.tcBody}>
              Cue Line uses Anthropic's Claude AI for script parsing and line evaluation. When you use these features, your script text and practice attempts are sent to Anthropic's servers. Review Anthropic's privacy policy at anthropic.com.
            </Text>
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          <Text style={styles.sectionText}>
            Cue Line does not collect personal information beyond what is necessary to provide its features. If you opt into in-app purchases or subscription, payment information is handled by Apple (iOS) or Google (Android), not by Cue Line directly.
          </Text>
        </View>

        <View style={styles.agreementRow}>
          <TouchableOpacity
            style={[styles.checkbox, agreed && styles.checkboxChecked]}
            onPress={() => setAgreed(!agreed)}
            activeOpacity={0.7}
          >
            {agreed && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
          <Text style={styles.agreementText}>
            I agree to these terms and understand my responsibility for any content I upload or record.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="I Agree & Continue"
          onPress={handleAgree}
          disabled={!agreed}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: 120,
    gap: Spacing.xl,
  },
  title: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  sectionText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  tcCard: {
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  tcSubtitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.accent,
  },
  tcBody: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  checkmark: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.white,
  },
  agreementText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
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
