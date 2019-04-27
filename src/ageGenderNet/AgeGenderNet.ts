import * as tf from '@tensorflow/tfjs-core';
import { NetInput, NeuralNetwork, TNetInput, toNetInput } from 'tfjs-image-recognition-base';

import { fullyConnectedLayer } from '../common/fullyConnectedLayer';
import { seperateWeightMaps } from '../faceProcessor/util';
import { TinyXception } from '../xception/TinyXception';
import { extractParams } from './extractParams';
import { extractParamsFromWeigthMap } from './extractParamsFromWeigthMap';
import { NetOutput, NetParams } from './types';

export class AgeGenderNet extends NeuralNetwork<NetParams> {

  private _faceFeatureExtractor: TinyXception

  constructor(faceFeatureExtractor: TinyXception = new TinyXception(2)) {
    super('AgeGenderNet')
    this._faceFeatureExtractor = faceFeatureExtractor
  }

  public get faceFeatureExtractor(): TinyXception {
    return this._faceFeatureExtractor
  }

  public runNet(input: NetInput | tf.Tensor4D): NetOutput {

    const { params } = this

    if (!params) {
      throw new Error(`${this._name} - load model before inference`)
    }

    return tf.tidy(() => {
      const bottleneckFeatures = input instanceof NetInput
        ? this.faceFeatureExtractor.forwardInput(input)
        : input

      const pooled = tf.avgPool(bottleneckFeatures, [7, 7], [2, 2], 'valid').as2D(bottleneckFeatures.shape[0], -1)
      const age = fullyConnectedLayer(pooled, params.fc.age).as1D()
      const gender = fullyConnectedLayer(pooled, params.fc.gender)
      return { age, gender }
    })
  }

  public forwardInput(input: NetInput | tf.Tensor4D): NetOutput {
    const { age, gender } = this.runNet(input)
    return tf.tidy(() => ({ age, gender: tf.softmax(gender) }))
  }

  public async forward(input: TNetInput): Promise<NetOutput> {
    return this.forwardInput(await toNetInput(input))
  }

  public async predictAgeAndGender(input: TNetInput): Promise<{ age: number, gender: string, genderProbability: number }> {
    const netInput = await toNetInput(input)
    const out = await this.forwardInput(netInput)
    const age = (await out.age.data())[0]
    const probMale = (await out.gender.data())[0]

    const isMale = probMale > 0.5
    const gender = isMale ? 'male' : 'female'
    const genderProbability = isMale ? probMale : (1 - probMale)

    return { age, gender, genderProbability }
  }

  protected getDefaultModelName(): string {
    return 'age_gender_model'
  }

  public dispose(throwOnRedispose: boolean = true) {
    this.faceFeatureExtractor.dispose(throwOnRedispose)
    super.dispose(throwOnRedispose)
  }

  public loadClassifierParams(weights: Float32Array) {
    const { params, paramMappings } = this.extractClassifierParams(weights)
    this._params = params
    this._paramMappings = paramMappings
  }

  public extractClassifierParams(weights: Float32Array) {
    return extractParams(weights)
  }

  protected extractParamsFromWeigthMap(weightMap: tf.NamedTensorMap) {

    const { featureExtractorMap, classifierMap } = seperateWeightMaps(weightMap)

    this.faceFeatureExtractor.loadFromWeightMap(featureExtractorMap)

    return extractParamsFromWeigthMap(classifierMap)
  }

  protected extractParams(weights: Float32Array) {

    const classifierWeightSize = (512 * 1 + 1) + (512 * 2 + 2)

    const featureExtractorWeights = weights.slice(0, weights.length - classifierWeightSize)
    const classifierWeights = weights.slice(weights.length - classifierWeightSize)

    this.faceFeatureExtractor.extractWeights(featureExtractorWeights)
    return this.extractClassifierParams(classifierWeights)
  }
}