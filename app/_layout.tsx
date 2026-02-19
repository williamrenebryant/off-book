import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import 'react-native-reanimated';
import { getSettings } from '@/lib/storage';

// Replace this with your RevenueCat iOS public API key from the dashboard.
// Find it at: app.revenuecat.com → your project → API Keys
const RC_IOS_API_KEY = 'appl_REPLACE_WITH_YOUR_REVENUECAT_IOS_API_KEY';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
  });
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    // Only configure RevenueCat if a real API key is set (not the placeholder)
    if (Platform.OS === 'ios' && RC_IOS_API_KEY !== 'appl_REPLACE_WITH_YOUR_REVENUECAT_IOS_API_KEY') {
      Purchases.configure({ apiKey: RC_IOS_API_KEY });
      if (__DEV__) {
        Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
      }
    }
  }, []);

  // Check T&C acceptance on app launch
  useEffect(() => {
    getSettings().then(settings => {
      setTermsAccepted(settings.hasAcceptedTerms ?? false);
      if (!settings.hasAcceptedTerms) {
        router.replace('/welcome');
      }
    });
  }, []);

  if (!fontsLoaded || termsAccepted === null) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="welcome" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="upload" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="record" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="script/[id]/index" options={{ headerShown: false }} />
        <Stack.Screen name="script/[id]/scenes" options={{ headerShown: false }} />
        <Stack.Screen name="script/[id]/practice" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
