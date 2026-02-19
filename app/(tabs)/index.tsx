import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getScripts, deleteScript } from '@/lib/storage';
import { Script } from '@/types';
import Card from '@/components/ui/Card';

export default function HomeScreen() {
  const router = useRouter();
  const [scripts, setScripts] = useState<Script[]>([]);

  useFocusEffect(
    useCallback(() => {
      getScripts().then(setScripts);
    }, [])
  );

  const handleDelete = (script: Script) => {
    Alert.alert(
      'Remove Script',
      `Remove "${script.title}" from Off Book?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteScript(script.id);
            setScripts((prev) => prev.filter((s) => s.id !== script.id));
          },
        },
      ]
    );
  };

  const renderScript = ({ item }: { item: Script }) => (
    <TouchableOpacity
      onPress={() => router.push(`/script/${item.id}`)}
      onLongPress={() => handleDelete(item)}
      activeOpacity={0.75}
    >
      <Card variant="raised" style={styles.scriptCard}>
        <View style={styles.scriptHeader}>
          <View style={styles.scriptIcon}>
            <Ionicons name="document-text" size={20} color={Colors.accent} />
          </View>
          <View style={styles.scriptInfo}>
            <Text style={styles.scriptTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.scriptMeta}>
              {item.selectedCharacter
                ? item.selectedCharacter
                : `${item.characters.length} characters`}
              {' · '}
              {item.scenes.length} {item.scenes.length === 1 ? 'scene' : 'scenes'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
        </View>
      </Card>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Off Book</Text>
        <Text style={styles.subtitle}>Your scripts</Text>
      </View>

      {scripts.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={56} color={Colors.textLight} />
          <Text style={styles.emptyTitle}>No scripts yet</Text>
          <Text style={styles.emptyText}>
            Tap the + button to upload your first script.
          </Text>
        </View>
      ) : (
        <FlatList
          data={scripts}
          keyExtractor={(item) => item.id}
          renderItem={renderScript}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View style={styles.fabContainer}>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/upload')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color={Colors.white} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.recordFab}
          onPress={() => router.push('/record')}
          activeOpacity={0.85}
        >
          <Ionicons name="mic" size={24} color={Colors.white} />
        </TouchableOpacity>
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
    gap: Spacing.sm,
  },
  scriptCard: {
    gap: Spacing.sm,
  },
  scriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  scriptIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scriptInfo: {
    flex: 1,
  },
  scriptTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  scriptMeta: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  fabContainer: {
    position: 'absolute',
    bottom: Spacing.xl + 12,
    right: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'flex-end',
  },
  fab: {
    width: 56,
    height: 56,
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
  recordFab: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.accentDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accentDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
});
