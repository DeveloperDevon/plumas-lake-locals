import { Body, Container, Head, Heading, Html, Link, Preview, Text } from "@react-email/components";

interface MagicLinkEmailProps {
  url: string;
}

export function MagicLinkEmail({ url }: MagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Sign in to Plumas Lake Locals</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6", padding: "24px" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading as="h2">Sign in to Plumas Lake Locals</Heading>
          <Text>Click the link below to sign in. It expires in 15 minutes.</Text>
          <Link href={url}>Sign in</Link>
          <Text style={{ color: "#888888", fontSize: "12px" }}>
            If you didn&apos;t request this, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default MagicLinkEmail;
