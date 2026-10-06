import { Body, Container, Head, Heading, Html, Link, Preview, Text } from "@react-email/components";

interface InviteEmailProps {
  url: string;
  inviterName: string;
  note?: string | undefined;
}

export function InviteEmail({ url, inviterName, note }: InviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{inviterName} invited you to Plumas Lake Locals</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6", padding: "24px" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading as="h2">{inviterName} invited you to Plumas Lake Locals</Heading>
          {note ? <Text>&quot;{note}&quot;</Text> : null}
          <Text>
            Plumas Lake Locals is a private, invite-only community for Plumas Lake. This invite link
            is valid for 7 days and can only be used once. You must be 18 or older to join.
          </Text>
          <Link href={url}>Accept invite</Link>
        </Container>
      </Body>
    </Html>
  );
}

export default InviteEmail;
