import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme';

// iOS 26 Liquid Glass where available; a translucent surface elsewhere
// (older iOS, Android, web) so controls look the same shape everywhere.
export function Glass({ style, interactive, children }: { style?: StyleProp<ViewStyle>; interactive?: boolean; children?: React.ReactNode }) {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={style} isInteractive={interactive} glassEffectStyle="regular">
        {children}
      </GlassView>
    );
  }
  return <View style={[{ backgroundColor: colors.cardHigh }, style]}>{children}</View>;
}
