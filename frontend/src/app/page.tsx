'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      router.push('/dashboard');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-700 flex items-center justify-center px-4">
      <div className="max-w-4xl w-full text-center">
        <div className="mb-8">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4">VoiceAI Platform</h1>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Build, deploy, and manage AI-powered voice agents that can make and receive phone calls — powered by Claude, Deepgram, and ElevenLabs.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {[
            {
              icon: '🤖',
              title: 'AI Assistants',
              desc: 'Configure voice agents with custom prompts, personalities, and behaviors',
            },
            {
              icon: '📞',
              title: 'Phone Calls',
              desc: 'Handle inbound & outbound calls via Twilio with real-time voice AI',
            },
            {
              icon: '⚡',
              title: 'Real-time Streaming',
              desc: 'Low-latency STT → LLM → TTS pipeline for natural conversations',
            },
          ].map((feature) => (
            <div key={feature.title} className="bg-white/10 backdrop-blur rounded-xl p-6 text-left">
              <div className="text-3xl mb-3">{feature.icon}</div>
              <h3 className="text-white font-semibold text-lg mb-2">{feature.title}</h3>
              <p className="text-blue-100 text-sm">{feature.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-4 justify-center">
          <Link href="/auth/register" className="btn-primary px-8 py-3 text-base rounded-lg">
            Get Started Free
          </Link>
          <Link href="/auth/login" className="bg-white/10 text-white border border-white/30 hover:bg-white/20 btn px-8 py-3 text-base rounded-lg">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
