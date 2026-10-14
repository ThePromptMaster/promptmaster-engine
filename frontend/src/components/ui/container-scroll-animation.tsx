"use client";
import React, { useRef, useMemo } from "react";
import {
  useScroll,
  useTransform,
  useSpring,
  motion,
  type MotionValue,
} from "framer-motion";

const SPRING_CONFIG = { stiffness: 100, damping: 30, restDelta: 0.001 };

export const ContainerScroll = ({
  titleComponent,
  children,
}: {
  titleComponent: string | React.ReactNode;
  children: React.ReactNode;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
  });
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const scaleDimensions = useMemo(
    () => (isMobile ? [0.7, 0.9] : [1.05, 1]),
    [isMobile]
  );

  // Raw transforms from scroll position
  const rotateRaw = useTransform(scrollYProgress, [0, 1], [12, 0]);
  const scaleRaw = useTransform(scrollYProgress, [0, 1], scaleDimensions);
  const translateRaw = useTransform(scrollYProgress, [0, 1], [0, -80]);

  // Smooth with springs — prevents jank from discrete scroll events
  const rotate = useSpring(rotateRaw, SPRING_CONFIG);
  const scale = useSpring(scaleRaw, SPRING_CONFIG);
  const translate = useSpring(translateRaw, SPRING_CONFIG);

  return (
    <div
      className="h-[30rem] sm:h-[40rem] md:h-[60rem] flex items-center justify-center relative p-2 md:p-20"
      ref={containerRef}
    >
      <div className="py-4 sm:py-10 md:py-40 w-full relative" style={{ perspective: "1000px" }}>
        <Header translate={translate} titleComponent={titleComponent} />
        <Card rotate={rotate} scale={scale}>
          {children}
        </Card>
      </div>
    </div>
  );
};

export const Header = ({
  translate,
  titleComponent,
}: {
  translate: MotionValue<number>;
  titleComponent: React.ReactNode;
}) => {
  return (
    <motion.div
      style={{ translateY: translate, willChange: "transform" }}
      className="max-w-5xl mx-auto text-center"
    >
      {titleComponent}
    </motion.div>
  );
};

export const Card = ({
  rotate,
  scale,
  children,
}: {
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  children: React.ReactNode;
}) => {
  return (
    <motion.div
      style={{
        rotateX: rotate,
        scale,
        willChange: "transform",
        backfaceVisibility: "hidden",
        transformStyle: "preserve-3d",
      }}
      className="max-w-5xl mt-4 md:mt-8 mx-auto h-[20rem] sm:h-[30rem] md:h-[40rem] w-full container-scroll-card"
    >
      {/* Static inner shell — border-radius only here, NOT on the animated parent */}
      <div className="h-full w-full border-4 border-white/10 bg-[#111118] rounded-[30px] p-2 md:p-6">
        <div className="h-full w-full overflow-hidden rounded-2xl bg-[#1a1a2e] md:p-4">
          {children}
        </div>
      </div>
    </motion.div>
  );
};
