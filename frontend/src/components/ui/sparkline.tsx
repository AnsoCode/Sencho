import * as React from "react"

import { cn } from "@/lib/utils"

type SvgSvgAttrs = Omit<React.SVGAttributes<SVGSVGElement>, "points" | "strokeWidth">

export interface SparklineProps extends SvgSvgAttrs {
  points: number[]
  stroke?: string
  fill?: string
  peakIndex?: number
  peakColor?: string
  showPeak?: boolean
  strokeWidth?: number
  min?: number
  max?: number
  width?: number
  height?: number
}

const VIEW_W = 100
const VIEW_H = 28
const PEAK_R = 0.9

export const Sparkline = React.forwardRef<SVGSVGElement, SparklineProps>(
  (
    {
      points,
      stroke = "var(--chart-1)",
      fill = "var(--chart-1)",
      peakIndex,
      peakColor = "var(--data-peak)",
      showPeak = true,
      strokeWidth,
      min,
      max,
      width,
      height,
      className,
      ...rest
    },
    ref,
  ) => {
    const id = React.useId()

    if (!points || points.length < 2) {
      return (
        <svg
          ref={ref}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className={cn("block h-full w-full", className)}
          width={width}
          height={height}
          {...rest}
          aria-hidden="true"
        />
      )
    }

    const lo = min ?? Math.min(...points)
    const hi = max ?? Math.max(...points)
    const range = hi - lo || 1

    const coords = points.map((v, i) => {
      const x = (i / (points.length - 1)) * VIEW_W
      const y = VIEW_H - ((v - lo) / range) * VIEW_H
      return [x, y] as const
    })

    const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
    const area = `${line} L${VIEW_W.toFixed(2)},${VIEW_H} L0,${VIEW_H} Z`

    const resolvedPeakIndex =
      typeof peakIndex === "number"
        ? peakIndex
        : points.indexOf(Math.max(...points))

    const peak = showPeak && resolvedPeakIndex >= 0 ? coords[resolvedPeakIndex] : null

    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className={cn("block h-full w-full overflow-visible", className)}
        width={width}
        height={height}
        {...rest}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`spark-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity={0.35} />
            <stop offset="100%" stopColor={fill} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#spark-fill-${id})`} stroke="none" vectorEffect="non-scaling-stroke" />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth ?? 1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {peak ? (
          <circle
            cx={peak[0]}
            cy={peak[1]}
            r={PEAK_R}
            fill={peakColor}
            stroke="var(--background)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
    )
  },
)

Sparkline.displayName = "Sparkline"
